"""Apply inspected text-role text and card roles without changing business content."""
from lxml import etree
from pptx import Presentation
from pptx.util import Pt
from brand_config import RULES, PROFILE, BRAND
import slide_compliance as C
E = C.E


def find_shape(tree, ident):
    return next((el for el in tree.iter(E.P+"sp") if C.sid(el)==str(ident)), None)


def corner_adjustment(el):
    """Keep the visible radius constant, including uniformly scaled groups."""
    radius = RULES['template_contract']['metric_corner_radius_pt'] * 12700
    sx = sy = 1.0
    for parent in el.iterancestors(E.P+'grpSp'):
        xf = parent.find(E.P+'grpSpPr/'+E.A+'xfrm')
        ext = xf.find(E.A+'ext') if xf is not None else None
        child = xf.find(E.A+'chExt') if xf is not None else None
        if ext is not None and child is not None:
            if not int(child.get('cx',0)) or not int(child.get('cy',0)):
                raise ValueError('Rounded metric card has invalid group dimensions.')
            sx *= int(ext.get('cx')) / int(child.get('cx'))
            sy *= int(ext.get('cy')) / int(child.get('cy'))
    if abs(sx-sy) > 1e-6:
        raise ValueError('Ungroup nonuniformly scaled metric cards before applying a constant corner radius.')
    box = C.shape_box(el)
    short = min(box[2:]) * sx if box else 0
    if short < 2*radius:
        raise ValueError('Metric cards must be at least twice the fixed corner radius in both dimensions.')
    return round(100000 * radius / short)


def validate(prs, plan):
    if plan is None:
        return {}
    if not isinstance(plan, dict) or set(plan) != {'slides'} or not isinstance(plan['slides'], dict):
        raise ValueError('Template plan must contain a slides object keyed by slide number.')
    result = {}
    allowed = {'role', 'family', 'title', 'subtitle', 'body', 'text_roles', 'metric_cards', 'panels'}
    families = RULES['template_contract']['samples']
    type_roles = RULES['template_contract']['text_roles']
    for key, item in plan['slides'].items():
        if not isinstance(key, str) or not key.isdecimal() or str(int(key)) != key or not 1 <= int(key) <= len(prs.slides):
            raise ValueError(f'Invalid template-plan slide: {key}')
        if not isinstance(item, dict) or set(item) - allowed:
            raise ValueError('text-role plans use text_roles, not column plans or arbitrary style overrides.')
        if item.get('role') not in ('cover', 'content', 'closing'):
            raise ValueError('text-role has no approved section-divider family. Inspect the required example using the fallback policy first.')
        if item.get('family', item['role']) not in families:
            raise ValueError('Unknown text-role exemplar family.')
        tree = prs.slides[int(key)-1].shapes._spTree
        assigned = set()
        def shape(ident, text=True):
            if ident is None or str(ident) in assigned:
                raise ValueError('Missing or reused shape ID in text-role plan.')
            assigned.add(str(ident))
            el = find_shape(tree, str(ident))
            if el is None or el.tag != E.P+'sp' or (text and not E.text_of(el).strip()):
                raise ValueError(f'Slide {key}, shape {ident}: expected an existing native shape.')
            return el
        if shape(item.get('title')).getparent() is not tree:
            raise ValueError('Title must be a top-level shape; inspect and ungroup it before assigning slide geometry.')
        if item.get('subtitle') is not None and shape(item['subtitle']).getparent() is not tree:
            raise ValueError('Subtitle must be a top-level shape; inspect and ungroup it before assigning slide geometry.')
        if not isinstance(item.get('body', []), list):raise ValueError('body must be a list.')
        for ident in item.get('body', []):shape(ident)
        if not isinstance(item.get('text_roles', {}), dict):raise ValueError('text_roles must be an object.')
        for ident, roles in item.get('text_roles', {}).items():
            el = shape(ident)
            roles = [roles] if isinstance(roles, str) else roles
            if not isinstance(roles, list) or not roles or any(not isinstance(r,str) or r not in type_roles or r in ('legal','title','display','subtitle') for r in roles):
                raise ValueError('Invalid content text role; legal sizes cannot be assigned to business content.')
            count = len(list(el.iter(E.A+'p')))
            if len(roles) not in (1, count):raise ValueError('Mixed-style role lists must cover every paragraph exactly.')
        for category in ('metric_cards', 'panels'):
            if not isinstance(item.get(category, []), list):raise ValueError(f'{category} must be a list.')
            # Card geometry may belong to the same shape as its mapped text.
            for ident in item.get(category, []):
                el = find_shape(tree, str(ident))
                if el is None or el.tag != E.P+'sp' or el.find(E.P+'spPr/'+E.A+'prstGeom') is None:
                    raise ValueError('Card geometry requires an existing preset native shape.')
                if category == 'metric_cards':corner_adjustment(el)
        if set(map(str,item.get('metric_cards',[]))) & set(map(str,item.get('panels',[]))):
            raise ValueError('A card cannot be both rounded metric and square panel.')
        result[int(key)] = item
    return result


def apply(prs, plan, stats):
    if not plan:return []
    from template_alignment import clone_art
    template = Presentation(PROFILE/'template.pptx')
    roles = RULES['template_contract']['text_roles']; expected=[]
    bold_roles=set(RULES['template_contract']['bold_roles'])
    for n,item in plan.items():
        slide=prs.slides[n-1]; tree=slide.shapes._spTree
        def style(ident, names, box=None, color=None, anchor='t'):
            el=find_shape(tree,str(ident))
            if box is not None:C.set_box(el,tuple(v*12700 for v in box))
            paras=list(el.iter(E.A+'p')); names=[names]*len(paras) if isinstance(names,str) else names
            for para,name in zip(paras,names):
                for rp in E.run_props(para):
                    rp.set('sz',str(roles[name]*100));rp.set('b','1' if name in bold_roles else '0')
                    for latin in rp.findall(E.A+'latin'):latin.set('typeface',BRAND['font'])
                    if color or name=='source':
                        fill=rp.find(E.A+'solidFill')
                        if fill is None:fill=etree.SubElement(rp,E.A+'solidFill')
                        for child in list(fill):fill.remove(child)
                        etree.SubElement(fill,E.A+'srgbClr',val=(color or RULES['template_contract']['source_color']).lstrip('#'))
            bp=el.find(E.P+'txBody/'+E.A+'bodyPr')
            if bp is not None:
                bp.set('wrap','square');bp.set('anchor',anchor)
                for child in list(bp):
                    if child.tag in (E.A+'normAutofit',E.A+'spAutoFit'):bp.remove(child)
                if box is not None:
                    for attr in ('lIns','rIns','tIns','bIns'):bp.set(attr,'0')
            stats['template_shapes_aligned']+=1
            expected.append({'slide':n,'shape_id':str(ident),'sizes':[[int(r.get('sz'))/100 for r in E.run_props(p)] for p in paras]})
        role=item['role']
        style(item['title'],'title' if role=='content' else 'display',RULES['title_boxes'][role],RULES['title_colors'][role],'ctr' if role=='closing' else 't')
        if item.get('subtitle') is not None:
            if role=='closing':raise ValueError('Closing family has no subtitle role.')
            style(item['subtitle'],'subtitle',RULES['subtitle_boxes'][role],BRAND['roles']['ink'])
        for ident in item.get('body',[]):style(ident,'body')
        for ident,names in item.get('text_roles',{}).items():style(ident,names)
        for category,geometry,fillcolor in [('metric_cards','roundRect',RULES['template_contract']['metric_card_fill']),('panels','rect',RULES['template_contract']['panel_fill'])]:
            for ident in item.get(category,[]):
                el=find_shape(tree,str(ident));g=el.find(E.P+'spPr/'+E.A+'prstGeom');g.set('prst',geometry)
                for child in list(g):g.remove(child)
                adjustments=etree.SubElement(g,E.A+'avLst')
                if category=='metric_cards':
                    etree.SubElement(adjustments,E.A+'gd',name='adj',fmla=f'val {corner_adjustment(el)}')
                E.set_fill(el.find(E.P+'spPr'),fillcolor)
        # Product identity is slide-local on the approved cover/closing exemplars.
        if role in ('cover','closing'):
            sample=template.slides[RULES['template_contract']['samples'][role]-1]
            for sh in sample.shapes:
                if sh.name==RULES['template_contract'].get('product_shape_name'):clone_art(sample,slide,sh._element,'product-mark')
    return expected
