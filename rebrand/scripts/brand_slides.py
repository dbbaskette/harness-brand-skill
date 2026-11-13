#!/usr/bin/env python3
"""Single-brand identity pass using the vendored formatting engine."""
from __future__ import annotations
import argparse,copy,hashlib,io,json,re,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'vendor'))
import identity_engine as engine
from pptx import Presentation

ROOT=Path(__file__).resolve().parents[1]
from brand_config import BRAND,PROFILE,RULES


def image_only(tree,width,height):
    # Google export can store a real title as an ordinary text box, not a placeholder.
    if any(engine.text_of(e) for e in tree.iter(engine.P+'sp')):
        return False
    return ORIGINAL_IMAGE_ONLY(tree,width,height)


ORIGINAL_IMAGE_ONLY=engine.image_only
engine.image_only=image_only


def snapshot(prs):
    """Business text and media keyed by stable original shape IDs, including groups."""
    result=[]
    for slide in prs.slides:
        shapes={}
        for el in slide.shapes._spTree.iter(engine.P+'sp',engine.P+'pic',engine.P+'graphicFrame',engine.P+'cxnSp'):
            cn=el.find('.//'+engine.P+'cNvPr')
            if cn is None:continue
            value={'text':engine.text_of(el)}
            if el.tag==engine.P+'pic':
                blip=el.find('.//'+engine.A+'blip')
                rid=blip.get(engine.R+'embed') if blip is not None else None
                if rid:value['image']=hashlib.sha256(slide.part.rels[rid].target_part.blob).hexdigest()
            shapes[cn.get('id')]=value
        result.append(shapes)
    return result


def compliance_id(el):
    cn=el.find('.//'+engine.P+'cNvPr')
    return cn.get('id') if cn is not None else None


class Restyler(engine.Restyler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.allowed_removals={}
        self.repairs=[]  # what slide_repairs kept intact, for the report
    def corners(self):
        # A fully rounded square is a circle (letter and step badges): keep it one.
        import slide_repairs
        slide_repairs.keep_round_badges(self.prs,self.report,self.repairs)
        # Connector routing depends on the target's connection sites. Squaring a
        # connected rounded rectangle can collapse a curved relationship line.
        saved=[]
        for slide in self.prs.slides:
            tree=slide.shapes._spTree
            linked={e.get('id') for e in tree.iter(engine.A+'stCxn',engine.A+'endCxn')}
            for el in tree.iter(engine.P+'sp'):
                geom=el.find(engine.P+'spPr/'+engine.A+'prstGeom')
                if compliance_id(el) in linked and geom is not None:saved.append((el,copy.deepcopy(geom)))
        super().corners()
        for el,geom in saved:
            current=el.find(engine.P+'spPr/'+engine.A+'prstGeom')
            current.getparent().replace(current,geom)
        self.report['connected_geometry_preserved']+=len(saved)
    def titles(self,roles):
        # Exports sometimes tag every tool definition as a title. Only the actual
        # slide heading may lose bold; emphasis inside business copy is retained.
        for n,slide in enumerate(self.prs.slides,1):
            for el in slide.shapes._spTree.iter(engine.P+'sp'):
                if compliance_id(el)!=self.title_ids.get(n):continue
                colour=self.spec['roles'].get('cover_title','#000000') if roles.get(n)=='cover' else self.spec['roles']['title']
                for rp in engine.run_props(el):
                    self._run_color(rp,colour);rp.set('b','0')

    def _edge_deco(self,el):
        if super()._edge_deco(el):return True
        if engine.text_of(el) or el.tag not in (engine.P+'sp',engine.P+'cxnSp'):return False
        b=engine.xfrm_box(el)
        return bool(b and b[2]>=.8*self.sw and b[3]<=.10*self.sh and b[1]+b[3]>=.90*self.sh)
    def _decorations(self,slide,role):
        found=super()._decorations(slide,role)
        # A gradient backing a photo/quote panel is content, not an old template frame.
        pictures=[engine.xfrm_box(e) for e in slide.shapes._spTree if e.tag==engine.P+'pic']
        found=[e for e in found if not (e.find(engine.P+'spPr/'+engine.A+'gradFill') is not None
            and (b:=engine.xfrm_box(e)) and .10*self.sw*self.sh<b[2]*b[3]<.75*self.sw*self.sh
            and any(q and abs(q[0]-b[0])<.03*self.sw and abs(q[2]-b[2])<.03*self.sw for q in pictures))]
        tree=slide.shapes._spTree
        has_text=any(engine.text_of(e) for e in tree.iter(engine.P+'sp'))
        for el in tree:
            if el in found or engine.shape_name(el).startswith(engine.CHROME_PREFIX) or engine.text_of(el):continue
            b=engine.xfrm_box(el)
            if not b:continue
            full=b[2]*b[3]>=.75*self.sw*self.sh and engine.edges_touched(b,self.sw,self.sh)>=2
            if has_text and full and el.tag==engine.P+'pic' and not engine.has_alt_text(el):
                found.append(el)
            elif has_text and full and el.tag==engine.P+'sp' and engine.ph_type(el) is None:
                found.append(el)
        return [e for e in found if not engine.shape_name(e).startswith('source-layout:')]

    def slides(self,roles):
        for i,s in enumerate(self.prs.slides,1):
            allowed=set()
            for el in s.shapes._spTree:
                pt=engine.ph_type(el)
                identity=(pt in engine.FOOTER_PH and (pt!='ftr' or engine.LEGAL.search(engine.text_of(el)))) or self._old_page_number(el)
                if identity:
                    cn=el.find('.//'+engine.P+'cNvPr')
                    if cn is not None:allowed.add(cn.get('id'))
            for el in self._decorations(s,roles[i]):
                if engine.text_of(el):raise ValueError('Decoration detection attempted to remove content text.')
                for cn in el.iter(engine.P+'cNvPr'):allowed.add(cn.get('id'))
            for item in (self.o.get('remove') or '').split(','):
                if ':' not in item:continue
                number,name=item.split(':',1)
                if int(number)!=i:continue
                found=False
                for el in s.shapes._spTree:
                    if engine.shape_name(el)!=name:continue
                    if engine.text_of(el) or el.tag==engine.P+'graphicFrame':
                        raise ValueError('Explicit identity removal must be artwork, not text/chart content.')
                    found=True
                    for cn in el.iter(engine.P+'cNvPr'):allowed.add(cn.get('id'))
                if not found:raise ValueError(f'Brand artwork not found on slide {i}: {name}')
            self.allowed_removals[i]=allowed
        super().slides(roles)


def finish_styles(prs,restyler,roles,protected,title_ids):
    """Retain syntax colors, repair bullet contrast, and recognize exported text-box headings."""
    from lxml import etree
    for i,slide in enumerate(prs.slides,1):
        tree=slide.shapes._spTree
        for el in list(tree.iter(engine.P+'graphicFrame')):
            key=(i,engine.shape_name(el))
            if key in protected:
                saved=copy.deepcopy(protected[key])
                restyler._fonts(saved)
                el.getparent().replace(el,saved)
                restyler.report['syntax_tables_preserved']+=1
        for el in tree.iter(engine.P+'sp'):
            if engine.shape_name(el).startswith(engine.CHROME_PREFIX):continue
            body=el.find(engine.P+'txBody')
            if body is None:continue
            # Number glyphs may carry an explicit white theme color independently of text.
            for para in body.iter(engine.A+'p'):
                bc=para.find(engine.A+'pPr/'+engine.A+'buClr')
                if bc is not None:
                    for child in list(bc):bc.remove(child)
                    etree.SubElement(bc,engine.A+'srgbClr',val=BRAND['roles']['bullet'].lstrip('#'))
            box=engine.xfrm_box(el)
            text=engine.text_of(el)
            if not text or not box:continue
            is_title=compliance_id(el)==title_ids.get(i)
            if is_title:
                flat=engine.flat_shapes(tree)
                index=next((j for j,(e,_) in enumerate(flat) if e is el),None)
                bg=engine.backdrop(flat,index,'ffffff',restyler.scheme,engine.template_under(slide)) if index is not None else None
                colour=restyler.spec['roles'].get('cover_title','#000000') if roles.get(i)=='cover' else restyler.spec['roles']['title']
                if bg and engine.contrast(colour,bg)<3:colour=restyler.spec['roles']['on_dark']
                for rp in engine.run_props(body):
                    restyler._run_color(rp,colour);rp.set('b','0')
                    for effect in list(rp.findall(engine.A+'effectLst')):rp.remove(effect)
                for effect in list(el.findall(engine.P+'spPr/'+engine.A+'effectLst')):effect.getparent().remove(effect)


def reserve_footer(prs,report):
    from lxml import etree
    for i,slide in enumerate(prs.slides,1):
        if i==1:continue
        tree=slide.shapes._spTree
        content=[e for e in tree if e.tag in (engine.P+'sp',engine.P+'pic',engine.P+'grpSp',engine.P+'graphicFrame',engine.P+'cxnSp') and not engine.shape_name(e).startswith(engine.CHROME_PREFIX)]
        boxes=[engine.xfrm_box(e) for e in content]
        bottom=max((min(b[1]+b[3],prs.slide_height) for b in boxes if b and b[1]<prs.slide_height and b[0]<prs.slide_width and b[0]+b[2]>0),default=0)
        limit=.925*prs.slide_height
        if bottom<=limit:continue
        scale=min(1,limit/bottom)
        if scale<.90:raise ValueError(f'Slide {i} needs more than a minor footer fit; review its layout.')
        group=etree.Element(engine.P+'grpSp')
        nv=etree.SubElement(group,engine.P+'nvGrpSpPr')
        existing=[int(e.get('id')) for e in tree.iter(engine.P+'cNvPr')]
        etree.SubElement(nv,engine.P+'cNvPr',id=str(max(existing,default=0)+1),name='Brand content fit')
        etree.SubElement(nv,engine.P+'cNvGrpSpPr');etree.SubElement(nv,engine.P+'nvPr')
        gp=etree.SubElement(group,engine.P+'grpSpPr');x=etree.SubElement(gp,engine.A+'xfrm')
        etree.SubElement(x,engine.A+'off',x=str(int((1-scale)*prs.slide_width/2)),y='0')
        etree.SubElement(x,engine.A+'ext',cx=str(int(prs.slide_width*scale)),cy=str(int(prs.slide_height*scale)))
        etree.SubElement(x,engine.A+'chOff',x='0',y='0')
        etree.SubElement(x,engine.A+'chExt',cx=str(prs.slide_width),cy=str(prs.slide_height))
        for e in content:group.append(e)
        tree.insert(2,group)
        report['content_groups_fit_to_footer']+=1


def apply(source,output,remove=None,template_plan=None):
    profile=json.loads((PROFILE/'brand.json').read_text())
    spec=copy.deepcopy(profile['variants']['light'])
    if RULES.get('footer_surface'):
        spec['slides']['content']['elements'].insert(0,copy.deepcopy(RULES['footer_surface']))
    prs=Presentation(source)
    import slide_compliance as compliance
    roles=compliance.roles_for(prs)
    import template_alignment
    plan=template_alignment.validate(prs,template_plan)
    roles.update({n:item['role'] for n,item in plan.items()})
    if any(role not in RULES.get('allowed_slide_roles', ['cover','content','section','closing']) for role in roles.values()):
        raise ValueError('This brand has no approved family for a source slide role. Inspect its fallback policy before proceeding.')
    compliance.materialize_font_sizes(prs)
    compliance.preserve_layout_text(prs,roles)
    compliance.preserve_sidebar_layouts(prs,roles)
    title_ids={i:compliance.sid(h) for i,slide in enumerate(prs.slides,1) if (h:=compliance.heading(slide)) is not None}
    # A big number in the title placeholder is the slide's statistic: keep its size, place and
    # weight by not treating it as the heading (such a slide has no heading of its own).
    canvas=960*12700/prs.slide_width
    statistics=[i for i,slide in enumerate(prs.slides,1) if roles[i]=='content' and (h:=compliance.heading(slide)) is not None and compliance.is_statistic(h,canvas)]
    for i in statistics:del title_ids[i]
    # A subtitle placeholder holding several paragraphs or a long passage is body content (the
    # "Big Quote" layout keeps its quote and attribution there), not the one-line brand subtitle.
    def one_liner(el):
        paragraphs=[p for p in el.iter(engine.A+'p') if engine.text_of(p).strip()]
        return len(paragraphs)<=1 and len(engine.text_of(el).split())<=30
    subtitle_ids={i:compliance.sid(el) for i,slide in enumerate(prs.slides,1) for el in slide.shapes._spTree
                  if engine.ph_type(el)=='subTitle' and one_liner(el)}
    for n,item in plan.items():
        title_ids[n]=str(item['title'])
        if item.get('subtitle') is not None:subtitle_ids[n]=str(item['subtitle'])
    before=snapshot(prs)
    original_title_colors={}
    for n,slide in enumerate(prs.slides,1):
        h=compliance.heading(slide)
        if h is not None:
            colors=[e.get('val') for rp in engine.run_props(h) for e in rp.findall(engine.A+'solidFill/'+engine.A+'srgbClr')]
            if colors and len(set(colors))==1:original_title_colors[n]=colors[0]
    protected={};image_backdrops=[]
    syntax_colors={}
    for i,slide in enumerate(prs.slides,1):
        flat=engine.flat_shapes(slide.shapes._spTree)
        for j,(el,b) in enumerate(flat):
            fill=el.find(engine.P+'spPr/'+engine.A+'solidFill/'+engine.A+'srgbClr')
            if fill is None or not b:continue
            color=fill.get('val')
            if engine.luminance(color)<.1 and engine.chroma(color)<30 and any(e.tag==engine.P+'pic' and q and b[0]<=q[0] and b[1]<=q[1] and q[0]+q[2]<=b[0]+b[2] and q[1]+q[3]<=b[1]+b[3] for e,q in flat[j+1:]):
                image_backdrops.append(el)
        for el in slide.shapes._spTree.iter(engine.P+'graphicFrame'):
            # Single-cell tables used as highlighted code blocks are not data tables.
            if len(list(el.iter(engine.A+'tc')))==1 and el.find('.//'+engine.A+'highlight') is not None:
                protected[(i,engine.shape_name(el))]=copy.deepcopy(el)
                for c in el.iter(engine.A+'srgbClr'):
                    syntax_colors['syntax-'+c.get('val')]= '#'+c.get('val')

    restyler=Restyler(prs,profile,'light',spec,str(PROFILE),{'remove':remove,'_src':str(source)})
    restyler.title_ids=title_ids
    if statistics:restyler.report['statistic_titles_preserved']+=len(statistics)
    restyler.run(roles)
    finish_styles(prs,restyler,roles,protected,title_ids)
    # Transparent content images were designed for a dark backing. Mapping that
    # backing to medium gray can erase their embedded labels, which cannot be edited.
    for el in image_backdrops:
        engine.set_fill(el.find(engine.P+'spPr'),RULES['dark_backdrop'])
        restyler.report['dark_image_backdrops_preserved']+=1
    prs=compliance.attach_template(prs,roles,restyler.report)
    shadowless=[]
    compliance.visual_rules(prs,roles,title_ids,restyler.report,subtitle_ids,shadowless)
    # Repair what the identity pass itself would damage: shapes that vanish without their
    # shadow, and a subtitle pushed away from its title.
    import slide_repairs
    slide_repairs.restore_outlines(prs,roles,shadowless,restyler.scheme,restyler.spec,restyler.report,restyler.repairs)
    stacked=slide_repairs.stack_subtitles(prs,roles,title_ids,subtitle_ids,restyler.report,restyler.repairs)
    compliance.fit_content(prs,{n:r for n,r in roles.items() if n not in plan},title_ids,restyler.report,keep=stacked)
    for slide in prs.slides:
        for el in slide.shapes._spTree.iter(engine.P+'sp'):
            if not engine.shape_name(el).startswith('brand:'):compliance.fit_single_line(el,restyler.report)
    template_expected=template_alignment.apply(prs,plan,restyler.report)
    # Evaluate contrast after planned typography and panel fills have been applied.
    # Font ramp changes can raise the contrast requirement for small diagram labels.
    for n,slide in enumerate(prs.slides,1):
        flat=engine.flat_shapes(slide.shapes._spTree)
        for k,(el,_) in enumerate(flat):
            if el.tag!=engine.P+'sp' or engine.shape_name(el).startswith('brand:'):continue
            body=el.find(engine.P+'txBody')
            bg=engine.backdrop(flat,k,'ffffff',restyler.scheme,engine.template_under(slide))
            if body is not None and bg:
                restyler._fix_runs(body,bg,title=False,slide=n)
                # Brand rules prohibit white on bright cyan/cobalt even at large sizes.
                for rp in engine.run_props(body):
                    fill=rp.find(engine.A+'solidFill/'+engine.A+'srgbClr')
                    if fill is not None and fill.get('val','').lower()=='ffffff' and engine.contrast('ffffff',bg)<4.5:
                        restyler._run_color(rp,'#000000');restyler.report['light_fill_contrast_fixed']+=1
            elif body is not None and compliance.sid(el)==title_ids.get(n) and n in original_title_colors:
                # Keep known source contrast on photographs; pixels cannot be audited as a solid fill.
                compliance.style_text(el,color=original_title_colors[n])
                restyler.report['photo_title_colors_retained']+=1
    after=snapshot(prs)
    for i,(left,right) in enumerate(zip(before,after),1):
        for sid,value in left.items():
            if sid in restyler.allowed_removals[i]:continue
            if right.get(sid)!=value:
                raise ValueError(f'Business content changed on slide {i}, shape {sid}; refusing output.')
    if restyler.report['image_only_slides']:
        raise ValueError('Image-only slides cannot be natively rebranded; no branded success is claimed.')
    prs.save(output)
    from brand_ooxml import content_manifest
    original_manifest=content_manifest(Path(source).read_bytes())
    result_manifest=content_manifest(Path(output).read_bytes())
    for left,right in zip(original_manifest['slides'],result_manifest['slides']):
        if left['notes']!=right['notes'] or left['links']!=right['links']:
            raise ValueError('Slide notes or hyperlinks changed; refusing output.')
    audit_spec=copy.deepcopy(spec)
    audit_spec['palette'].update(syntax_colors)
    # Judge each slide as the role it was formatted as, not a second guess from the output.
    audit=engine.check_deck(str(output),profile,'light',audit_spec,roles=roles)
    # Identity is now inherited from the supplied master, not generated slide-local chrome.
    for slide in audit['slides']:
        slide['issues']=[x for x in slide['issues'] if x['type']!='no_brand_chrome']
    audit['summary']=dict(__import__('collections').Counter(x['type'] for slide in audit['slides'] for x in slide['issues']))
    audit['pass']=not any(x['type'] not in ('title_case',) for slide in audit['slides'] for x in slide['issues'])
    rules_report=compliance.audit(prs,roles,title_ids,restyler.report)
    if template_expected:rules_report['template_expectations']=template_expected
    rules_report['template_plan_applied']=sorted(plan)
    rules_report['exact_template_match']=False  # native visual and role review are still required
    # Listed in the report so every repair to the source layout can be checked.
    if restyler.repairs:rules_report['layout_repairs']=restyler.repairs
    return {'changes':dict(restyler.report),'notes':restyler.notes,'audit':audit,
            'compliance':rules_report,'content_verified':True,'replaced_identity_shapes':{str(k):sorted(v) for k,v in restyler.allowed_removals.items() if v}}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source');p.add_argument('output');p.add_argument('--remove-brand-shape',action='append',default=[])
    a=p.parse_args()
    print(json.dumps(apply(a.source,a.output,','.join(a.remove_brand_shape)),indent=2))
if __name__=='__main__':main()
