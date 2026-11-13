"""Readable, private sidecar reports; findings are not compliance scores."""
import json
from pathlib import Path
from brand_config import BRAND,ASSET_VERSION

ADVISORY={'effective_type_size','subtitle_spacing','approved_imagery'}
EDITORIAL={'subtitle','copy_density','sentence_case_review','chapter_metadata'}


def categorize(compliance):
    groups={'formatting':[],'author_decisions':[],'review_reminders':[]}
    for entry in compliance.get('exceptions',[]):
        key='review_reminders' if entry['rule'] in ADVISORY else 'author_decisions' if entry['rule'] in EDITORIAL else 'formatting'
        groups[key].append(entry)
    return groups


def next_action(result):
    review=result.get('visual_review');status=result.get('status')
    if status in ('incomplete','review_incomplete','error'):
        if result.get('file_id'):return 'Inspect the existing native copy and the saved report. Do not create another copy to diagnose this failure.'
        if result.get('preview_file'):return 'No native copy was created. Inspect the flagged pages in the saved preview before retrying.'
        return 'Resolve the reported error before retrying. If an upload was attempted, inspect Drive first; writes are not retried.'
    if status=='preview':return 'Local formatting completed; no native copy was created.'
    if not isinstance(review,dict):return 'Content checks do not establish visual acceptance. Inspect the native file and its rendered pages.'
    if review.get('status')!='passed':return 'Inspect the listed findings before using the result.'
    return 'Visual review completed. Review the remaining author decisions and brand exceptions before external use.'


def local_link(label,path):
    return f'[{label}](<{Path(path).resolve()}>)'


def save(result,directory):
    result['brand_assets']=ASSET_VERSION.copy()
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    result['report_files']={'markdown':str((directory/'report.md').resolve()),'json':str((directory/'result.json').resolve())}
    result['next_action']=next_action(result)
    lines=['# '+BRAND['name']+' branding report','',result.get('name','Branding run'),'',f"Result: **{result.get('status','unknown')}**",'']
    lines+=[result['next_action'],'',f"Brand asset snapshot: `{ASSET_VERSION['sha256']}`.",'']
    if result.get('error'):lines+=['Error: '+result['error'],'']
    if result.get('url'):lines+=['[Open native file]('+result['url']+')','']
    for key,label in [('preview_file','Open branded preview'),('source_file','Open source export'),('returned_file','Open native export')]:
        if result.get(key):lines+=[local_link(label,result[key]),'']
    if result.get('local_content_verified'):lines+=['Local business content preservation: verified.','']
    lines+=['Native content preservation: '+('verified' if result.get('content_verified') else 'not verified' if result.get('file_id') else 'not applicable; no native copy created')+'.',
            'This report separates measurable formatting findings, author decisions, and review reminders. Counts are not a compliance score.','']
    if result.get('elapsed_seconds') is not None:lines += [f"Elapsed: {result['elapsed_seconds']:.2f}s.",'']
    swaps=result.get('compliance',{}).get('icon_replacements',[])
    if swaps:
        lines+=['## Inspected icon replacements','','| Slide / drawing | Target | Approved icon | Treatment |','| --- | --- | --- | --- |']
        for entry in swaps:lines.append(f"| {entry.get('slide','Document')} | {entry.get('shape_id',entry.get('drawing_id'))} | {entry['icon']} | {entry['style']} |")
        lines+=['','All other business wording and imagery remain protected.','']
    repairs=result.get('compliance',{}).get('layout_repairs',[])
    if repairs:
        lines+=['## Layout kept intact','','Branding removes shadows, squares corners and moves the title block. These repairs keep what that would otherwise damage; check them on the rendered slides.','',
                '| Slide | Shape ID | Repair | Detail |','| --- | --- | --- | --- |']
        for entry in repairs:
            lines.append(f"| {entry['slide']} | {entry.get('shape_id') or '—'} | {entry['change']}{'' if entry.get('status')=='applied' else ' (not applied)'} | {entry['detail'].replace('|',' / ')} |")
        lines+=['']
    kept=result.get('compliance',{}).get('round_trip_repairs',[])
    if kept:
        lines+=['## Kept through the Google import','',"Google's import of the upload replaces icon fonts with a text font and restarts numbered lists after blank lines. These repairs keep both; an icon kept as a picture can no longer be edited as text.",'',
                '| Slide | Shape ID | Repair | Detail |','| --- | --- | --- | --- |']
        grouped={}
        for entry in kept:
            if entry['change']=='icon kept as picture' and entry.get('status')=='applied':grouped.setdefault(entry['slide'],[]).append(entry)
        for entry in kept:
            if entry in grouped.get(entry['slide'],[]):
                batch=grouped.pop(entry['slide'],None)
                if batch:
                    names=', '.join(e['detail'].split("'")[1] for e in batch)
                    lines.append(f"| {entry['slide']} | {', '.join(str(e['shape_id']) for e in batch)} | icon kept as picture ×{len(batch)} | {names} |")
                continue
            lines.append(f"| {entry['slide']} | {entry.get('shape_id') or '—'} | {entry['change']}{'' if entry.get('status')=='applied' else ' (unresolved)'} | {entry['detail'].replace('|',' / ')} |")
        lines+=['']
    summary=result.get('compliance',{}).get('slide_summary',[])
    if summary:
        lines+=['## What was done, slide by slide','','Compared with the source export, shape by shape. "Open" counts the findings listed for that slide further down.','',
                '| Slide | Branding | Repairs | Open |','| --- | --- | --- | --- |']
        for row in summary:
            lines.append(f"| {row['slide']} | {'; '.join(row['changes']).replace('|',' / ')} | {'; '.join(row['repairs']) or '—'} | {row['open'] or '—'} |")
        lines+=['']
    review=result.get('visual_review')
    if isinstance(review,dict):
        lines+=['## Visual review','',f"Status: **{review.get('status','required')}**. Model calls: {review.get('model_calls',0)}. Repair batches: {review.get('repair_batches',0)}.",'']
        lines += ['Compared against original: '+('yes' if review.get('source_compared') else 'no')+'.','']
        if review.get('reviewer'):lines+=[f"Reviewed in {review['reviewer']['harness']}; rendered pages and extracted text were sent to {review['reviewer']['provider']}.",'']
        timings=review.get('timings_seconds',{})
        if timings:
            lines+=['Measured review stages: '+', '.join(f"{key.replace('_',' ')} {value:.2f}s" for key,value in timings.items())+'.','']
        if review.get('error'):lines += [review['error'],'']
        regressions=sorted({i['page'] for i in review.get('issues',[]) if i['kind']=='regression'})
        if regressions:lines+=['Blocking regressions on slides/pages: '+', '.join(map(str,regressions))+'.','']
        evidence=sorted({i['page'] for i in review.get('issues',[])})
        for n in evidence:
            links=[]
            for key,label in [('baseline_images','Original'),('images','Branded')]:
                path=review.get(key,{}).get(str(n))
                if path:links.append(local_link(label,path))
            if links:lines += [f"Page {n}: "+' · '.join(links)+'  ']
        if evidence:lines+=['']
        lines+=['| Slide/page | Shape ID | Kind | Finding |','| --- | --- | --- | --- |']
        for issue in review.get('issues',[]):
            lines.append(f"| {issue['page']} | {issue.get('shape_id') or '—'} | {issue['kind']} | {issue['detail'].replace('|',' / ').replace(chr(10),' ')} |")
        for fix in review.get('repairs',[]):
            lines.append(f"| {fix['page']} | {fix.get('shape_id') or '—'} | Repair {fix['status']} | {fix.get('detail','').replace('|',' / ')} |")
        lines+=['','A visual pass does not certify editorial compliance or image provenance.','']
    else:lines+=['Visual review: **required; not automatically performed**.','']
    names={'formatting':'Formatting findings to inspect','author_decisions':'Author decisions — no rewriting performed','review_reminders':'Review reminders — not confirmed defects'}
    for key,entries in categorize(result.get('compliance',{})).items():
        lines+=['## '+names[key],'','| Slide/page | Rule | Detail |','| --- | --- | --- |']
        for e in entries:
            lines.append(f"| {e['slide'] if e['slide'] is not None else 'Deck-wide'} | {e['rule']} | {e['detail'].replace('|',' / ')} |")
        if not entries:lines+=['| — | — | None recorded |']
        lines+=['']
    (directory/'report.md').write_text('\n'.join(lines),encoding='utf-8')
    (directory/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    return result
