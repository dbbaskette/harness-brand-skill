"""Apply an inspected role/shape plan using the locked native template.

The plan identifies semantic roles; it is not inferred from text size or slide order.
No text is rewritten and no font is reduced to fit. Unmapped content stays reported.
"""
import copy
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor"))
from lxml import etree
from pptx import Presentation
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
import slide_compliance as C
from brand_config import PROFILE, RULES
E = C.E


def validate(prs, plan):
    if RULES.get("alignment_mode")=="text-roles":
        from text_role_alignment import validate as role_validate
        return role_validate(prs, plan)
    if plan is None:
        return {}
    if RULES.get('alignment_mode') == 'preserve':
        raise ValueError('This brand uses content-preserving fitting, not an explicit template plan.')
    if not isinstance(plan, dict) or set(plan) != {'slides'} or not isinstance(plan['slides'], dict):
        raise ValueError('Template plan must contain a slides object keyed by slide number.')
    result = {}
    for key, item in plan['slides'].items():
        if not key.isdecimal() or str(int(key)) != key or not 1 <= int(key) <= len(prs.slides):
            raise ValueError(f'Invalid template-plan slide: {key}')
        if not isinstance(item, dict) or set(item) - {'role', 'title', 'subtitle', 'body', 'columns'}:
            raise ValueError(f'Invalid template-plan fields on slide {key}')
        if item.get('role') not in ('cover', 'section', 'content', 'closing'):
            raise ValueError(f'Invalid template role on slide {key}')
        if not isinstance(item.get('body', []), list) or not isinstance(item.get('columns', []), list):
            raise ValueError('body and columns must be lists.')
        columns = item.get('columns', [])
        if columns and (item['role'] != 'content' or len(columns) not in (2, 3, 4)):
            raise ValueError('Template columns require a content slide and 2, 3 or 4 columns.')
        ids = [item.get('title'), item.get('subtitle'), *item.get('body', [])]
        if item.get('title') is None:
            raise ValueError('Each planned slide requires its existing title shape ID.')
        for column in columns:
            if not isinstance(column, dict) or set(column) != {'heading', 'body'}:
                raise ValueError('Each column requires separate heading and body shape IDs.')
            ids.extend(column.values())
        ids = [str(i) for i in ids if i is not None]
        if len(ids) != len(set(ids)):
            raise ValueError('A shape cannot have two template roles.')
        tree = prs.slides[int(key)-1].shapes._spTree
        for ident in ids:
            el = C.shape_with(tree, ident)
            if el is None or el.tag != E.P+'sp' or not E.text_of(el).strip():
                raise ValueError(f'Slide {key}, shape {ident}: expected an existing top-level text shape; inspect/ungroup first.')
        result[int(key)] = item
    return result


def clone_art(source, slide, el, label):
    clone = copy.deepcopy(el)
    ident = max(int(e.get('id')) for e in slide.shapes._spTree.iter(E.P+'cNvPr'))
    for cn in clone.iter(E.P+'cNvPr'):
        ident += 1
        cn.set('id', str(ident)); cn.set('name', 'brand:template-'+label)
    for node in clone.iter():
        for key, value in list(node.attrib.items()):
            if key.startswith(E.R):
                rel = source.part.rels[value]
                node.set(key, slide.part.relate_to(rel.target_ref if rel.is_external else rel.target_part, rel.reltype, rel.is_external))
    for ph in list(clone.iter(E.P+'ph')):
        ph.getparent().remove(ph)
    slide.shapes._spTree.append(clone)


def section_frame(template, slide):
    sample = template.slides[RULES['template_contract']['samples']['section']-1]
    # The photo is inserted by attach_template; this native foreground freeform is
    # slide-local, not part of the section layout. Keep it above that photograph.
    for el in sample.shapes._spTree:
        if el.find(E.P+'spPr/'+E.A+'custGeom') is not None and not E.text_of(el).strip():
            clone_art(sample, slide, el, 'section-frame')


def apply(prs, plan, stats):
    if RULES.get("alignment_mode")=="text-roles":
        from text_role_alignment import apply as role_apply
        return role_apply(prs, plan, stats)
    if not plan:
        return []
    template = Presentation(PROFILE/'template.pptx')
    samples = RULES['template_contract']['samples']
    expected = []
    def text(slide, ident, sizes, color, box=None, bold=None, donor=None):
        el = C.shape_with(slide.shapes._spTree, str(ident))
        if el is None:
            raise ValueError(f'Planned shape {ident} moved inside a fitted group; inspect the source plan.')
        if box is not None:
            C.set_box(el, tuple(v*12700 for v in box))
        C.style_text(el, color=color, bold=bold)
        bp = el.find(E.P+'txBody/'+E.A+'bodyPr')
        bp.set('wrap', 'square'); bp.set('anchor', 't')
        if donor is not None:
            native=donor._element.find(E.P+'txBody/'+E.A+'bodyPr')
            if native is not None:
                for attr in ('anchor','anchorCtr','vert','rot'):
                    if native.get(attr) is not None:bp.set(attr,native.get(attr))
        for attr in ('lIns', 'rIns', 'tIns', 'bIns'):
            bp.set(attr, '0')
        for child in list(bp):
            if etree.QName(child).localname in ('normAutofit', 'spAutoFit'):
                bp.remove(child)
        for para in el.iter(E.A+'p'):
            pp = para.find(E.A+'pPr')
            level = int(pp.get('lvl', '0')) if pp is not None else 0
            size = sizes[min(level, len(sizes)-1)]
            for rp in E.run_props(para):
                rp.set('sz', str(round(size*100)))
            if pp is not None and (pp.find(E.A+'buChar') is not None or pp.find(E.A+'buAutoNum') is not None):
                for old in list(pp):
                    if old.tag in (E.A+'buClr', E.A+'buClrTx'):
                        pp.remove(old)
                bc = etree.SubElement(pp, E.A+'buClr')
                etree.SubElement(bc, E.A+'srgbClr', val=RULES['template_contract']['bullet_color'].lstrip('#'))
        stats['template_shapes_aligned'] += 1
        return el
    for n, item in plan.items():
        slide = prs.slides[n-1]; role = item['role']; columns = item.get('columns', [])
        title_size = RULES['title_size'] if role == 'content' else RULES['display_size']
        sample=template.slides[samples[role]-1]
        donor=next(sh for sh in sample.shapes if E.ph_type(sh._element) in E.TITLE_PH)
        text(slide, item['title'], [title_size], RULES['title_colors'][role], RULES['title_boxes'][role], False, donor)
        if item.get('subtitle') is not None:
            b = RULES['section_text_box'] if role == 'section' else RULES['subtitle_boxes'].get(role)
            if b is None:
                raise ValueError('The selected closing template has no subtitle role.')
            size = RULES['subtitle_size'] if role == 'content' else RULES['display_subtitle_size']
            text(slide, item['subtitle'], [size], '#ffffff' if role == 'section' else '#000000', b, False)
        for ident in item.get('body', []):
            text(slide, ident, RULES['template_contract']['body_levels'], '#000000')
        if columns:
            sample = template.slides[samples[f'columns_{len(columns)}']-1]
            name = sample.slide_layout.name
            layout = next(l for l in prs.slide_layouts if l.name == name)
            for rel in list(slide.part.rels.values()):
                if rel.reltype == RT.SLIDE_LAYOUT:
                    slide.part.drop_rel(rel.rId)
            slide.part.relate_to(layout.part, RT.SLIDE_LAYOUT)
            donors = [s for s in sample.shapes if s.has_text_frame and s.text.startswith('Header')]
            donors.sort(key=lambda s:s.left)
            ramp = RULES['template_contract']['column_levels'][str(len(columns))]
            for column, donor in zip(columns, donors):
                x,y,w = [v/12700 for v in (donor.left, donor.top, donor.width)]
                text(slide, column['heading'], [ramp[0]], '#000000', [x,y,w,ramp[0]*1.25], True)
                body_y = y + ramp[0]*1.25 + 12
                text(slide, column['body'], ramp[1:], '#000000', [x,body_y,w,RULES['content_bottom']-body_y])
        # Store every planned paragraph's target so review/repair cannot silently
        # turn a readable but smaller result into exact conformance.
        ids = [item['title'], item.get('subtitle'), *item.get('body', [])]
        for col in columns:
            ids.extend(col.values())
        for ident in ids:
            if ident is None:continue
            el = C.shape_with(slide.shapes._spTree, str(ident))
            expected.append({'slide':n,'shape_id':str(ident),'sizes':[[int(r.get('sz'))/100 for r in E.run_props(p)] for p in el.iter(E.A+'p')]})
    return expected
