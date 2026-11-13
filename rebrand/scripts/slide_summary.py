"""What branding did to each slide, in plain words, for a person to check against the deck.

Compares the source export with the formatted deck shape by shape (shape IDs are kept), then adds
the repairs and open findings the formatter recorded for that slide. A summary, not a proof: the
content checks are separate, and this never blocks a run."""
from __future__ import annotations
import io,sys,collections
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'vendor'))
import identity_engine as E

A,P=E.A,E.P


def _runs(el):
    out=[]
    for run in el.iter(A+'r'):
        props=run.find(A+'rPr')
        face=props.find(A+'latin').get('typeface') if props is not None and props.find(A+'latin') is not None else None
        fill=props.find(A+'solidFill') if props is not None else None
        colour=(fill[0].get('val') or '').lower() if fill is not None and len(fill) else None
        out.append((face,int(props.get('sz')) if props is not None and props.get('sz') else None,colour))
    return out


def _shapes(slide):
    out={}
    for el,box in E.flat_shapes(slide.shapes._spTree):
        node=el.find('.//'+P+'cNvPr')
        if node is None or not box:continue
        kind=el.tag.rsplit('}',1)[-1]
        fill=E.fill_of(el,{}) if kind=='sp' else (None,None)
        out[node.get('id')]={'kind':kind,'box':box,'runs':_runs(el) if kind=='sp' else [],'fill':fill,'name':node.get('name',''),
                             'shadow':el.find(P+'spPr/'+A+'effectLst/'+A+'outerShdw') is not None,'text':E.text_of(el).strip() if kind=='sp' else ''}
    return out


def _count(n,one,many=None):return f"{n} {one if n==1 else (many or one+'s')}"


def summarize(source,branded,compliance=None):
    """[{slide, role, changes:[...], repairs:[...], open:int}] for every slide of the branded deck."""
    from pptx import Presentation
    compliance=compliance or {}
    before,after=Presentation(io.BytesIO(source)),Presentation(io.BytesIO(branded))
    scale=after.slide_width/before.slide_width
    repairs=collections.defaultdict(list)
    for key in ('layout_repairs','round_trip_repairs'):
        grouped=collections.defaultdict(collections.Counter)
        for entry in compliance.get(key,[]):grouped[entry['slide']][(entry['change'],entry.get('status')=='applied')]+=1
        for slide,counts in grouped.items():
            for (change,applied),n in counts.items():repairs[slide].append(change+(f' ×{n}' if n>1 else '')+('' if applied else ' (not applied)'))
    swaps=collections.Counter(e.get('slide') for e in compliance.get('icon_replacements',[]))
    findings=collections.Counter(e['slide'] for e in compliance.get('exceptions',[]) if e.get('slide') is not None)
    roles={int(k):v for k,v in (compliance.get('roles') or {}).items()}
    rows=[]
    for n,(old,new) in enumerate(zip(before.slides,after.slides),1):
        a,b=_shapes(old),_shapes(new);changes=[]
        fonts=collections.Counter();sized=recoloured=refilled=moved=shadows=0
        for ident,shape in b.items():
            was=a.get(ident)
            if was is None:continue
            if len(was['runs'])==len(shape['runs']):
                for (f0,s0,c0),(f1,s1,c1) in zip(was['runs'],shape['runs']):
                    if f1 and f0!=f1:fonts[f1]+=1
                    if s0 and s1 and abs(s1/(s0*scale)-1)>0.04:sized+=1
                    if c0!=c1 and c1:recoloured+=1
            if was['fill'][0]!=shape['fill'][0] or (was['fill'][1] or '').lower()!=(shape['fill'][1] or '').lower():refilled+=1
            if was['shadow'] and not shape['shadow']:shadows+=1
            x0,y0,w0,h0=[v*scale for v in was['box']];x1,y1,w1,h1=shape['box']
            if max(abs(x1-x0),abs(y1-y0),abs(w1-w0),abs(h1-h0))>2*12700:moved+=1
        removed=[s for i,s in a.items() if i not in b]
        added=[s for i,s in b.items() if i not in a and not s['name'].startswith('brand:')]
        layout=new.slide_layout.name
        changes.append(f"{roles.get(n,'content')} slide on the “{layout}” layout")
        if fonts:changes.append('text set in '+', '.join(f'{name} ({_count(c,"run")})' for name,c in fonts.most_common(2)))
        if sized:changes.append(_count(sized,'text run')+' moved to a brand size')
        if recoloured:changes.append(_count(recoloured,'text run')+' recoloured')
        if refilled:changes.append(_count(refilled,'shape fill')+' recoloured')
        if shadows:changes.append(_count(shadows,'shadow')+' removed')
        if moved:changes.append(_count(moved,'shape')+' moved or resized beyond the canvas change')
        if removed:changes.append(_count(len(removed),'source shape')+' removed: '+', '.join((s['text'][:24] or s['name'][:24] or s['kind']) for s in removed[:3])+('…' if len(removed)>3 else ''))
        if added:changes.append(_count(len(added),'object')+' added'+(' (icons kept as pictures)' if any(s['name'].startswith('Icon: ') for s in added) else ''))
        if swaps.get(n):changes.append(_count(swaps[n],'icon')+' replaced with approved artwork')
        rows.append({'slide':n,'role':roles.get(n,'content'),'changes':changes,'repairs':repairs.get(n,[]),'open':findings.get(n,0)})
    return rows
