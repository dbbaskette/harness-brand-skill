#!/usr/bin/env python3
"""Brand a Google Slides deck or Doc through gcloud and Google Drive only."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys
import time
from urllib.parse import parse_qs, urlparse, urlencode, quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


FORMATS = {
    'application/vnd.google-apps.presentation': ('slides', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
    'application/vnd.google-apps.document': ('docs', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
}
DRIVE = 'https://www.googleapis.com/drive/v3/files'
UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
MAX_EXPORT = 40 * 1024 * 1024


class BrandError(Exception):
    pass


def file_id(value):
    value = value.strip()
    if re.fullmatch(r'[A-Za-z0-9_-]+', value):
        return value
    url = urlparse(value)
    if url.scheme != 'https' or url.hostname not in ('docs.google.com', 'drive.google.com'):
        raise ValueError('Use a Google Slides/Docs HTTPS URL or Drive file ID.')
    match = re.search(r'/(?:presentation/d|document/d|file/d|drive/folders)/([A-Za-z0-9_-]+)(?:/|$)', url.path)
    value = match.group(1) if match else parse_qs(url.query).get('id', [''])[0]
    if not re.fullmatch(r'[A-Za-z0-9_-]+', value):
        raise ValueError('Could not read a Drive file ID from the URL.')
    return value


def branded_name(name):
    return name if name.endswith('-branded') else name + '-branded'


class Drive:
    """Marketing Studio's token-in-memory, project-free Google Drive pattern."""
    def __init__(self, account=None):
        args = ['gcloud', 'auth', 'print-access-token', '--quiet']
        if account:
            args += ['--account', account]
        proc = subprocess.run(args, capture_output=True, text=True, timeout=60)
        self.token = proc.stdout.strip()
        if proc.returncode or len(self.token.split()) != 1:
            raise BrandError('gcloud authentication failed. Run gcloud auth login --enable-gdrive-access --force.')

    def request(self, url, *, method='GET', body=None, content_type='application/json', headers=None, binary=False, location=False):
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.hostname != 'www.googleapis.com' or not parsed.path.startswith(('/drive/v3/', '/upload/drive/v3/')):
            raise BrandError('Only fixed Google Drive API endpoints are allowed.')
        request_headers = {'Authorization': 'Bearer '+self.token, 'Content-Type': content_type, **(headers or {})}
        data = body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None
        req = Request(url, data=data, headers=request_headers, method=method)
        try:
            with urlopen(req, timeout=120) as response:
                if location:
                    target = response.headers.get('Location')
                    if not target:
                        raise BrandError('Google did not return an upload session; no upload attempted.')
                    return target
                data = response.read(MAX_EXPORT+1)
                if len(data) > MAX_EXPORT:
                    raise BrandError('Google response exceeds the 40 MB transfer limit.')
                return data if binary else json.loads(data)
        except HTTPError as exc:
            try:
                detail = json.load(exc).get('error', {})
                message = str(detail.get('message', 'Google Drive rejected the request'))[:800]
            except (ValueError, AttributeError):
                message = 'Google Drive rejected the request'
            finally:
                exc.close()
            message = message.replace(self.token, '[redacted]')
            if exc.code == 401 or 'scope' in message.lower():
                message += ' Run gcloud auth login --enable-gdrive-access --force.'
            raise BrandError(f'Google Drive HTTP {exc.code}: {message}') from None
        except (TimeoutError, URLError):
            raise BrandError('Google Drive network failure. Writes are not retried; inspect Drive before rerunning.') from None
        except (ValueError, UnicodeDecodeError):
            raise BrandError('Google Drive returned an invalid response.') from None

    def metadata(self, source):
        return self.request(DRIVE+'/'+quote(source, safe='')+'?'+urlencode({
            'supportsAllDrives':'true', 'fields':'id,name,mimeType,version,modifiedTime,capabilities(canCopy,canDownload),trashed,webViewLink'}))

    def export(self, source, mime):
        try:
            return self.request(DRIVE+'/'+quote(source, safe='')+'/export?'+urlencode({'mimeType':mime}), binary=True)
        except BrandError as exc:
            if 'too large to be exported' not in str(exc):raise
        # The export endpoint stops at 10 MB. Google gives each native file its own export links, which do not.
        links = self.request(DRIVE+'/'+quote(source, safe='')+'?'+urlencode({'supportsAllDrives':'true','fields':'exportLinks'})).get('exportLinks', {})
        link = links.get(mime, '')
        parsed = urlparse(link)
        if parsed.scheme != 'https' or parsed.hostname != 'docs.google.com' or not parsed.path.startswith('/feeds/download/'):
            raise BrandError('The source is too large for a normal export and Google offered no export link for it.')
        try:
            with urlopen(Request(link, headers={'Authorization': 'Bearer '+self.token}), timeout=300) as response:
                data = response.read(MAX_EXPORT+1)
        except HTTPError as exc:
            exc.close();raise BrandError(f'Google Drive HTTP {exc.code}: the large-file export was refused.') from None
        except (TimeoutError, URLError):
            raise BrandError('Google Drive network failure during the large-file export.') from None
        if len(data) > MAX_EXPORT:
            raise BrandError('The source exceeds the 40 MB transfer limit.')
        return data

    def import_native(self, data, name, native_mime, office_mime, folder=None):
        # Resumable protocol supports the supplied >5 MB example as well as small files.
        session = self.request(UPLOAD+'?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,webViewLink',
            method='POST', body={'name':name,'mimeType':native_mime,'parents':[folder or 'root']},
            headers={'X-Upload-Content-Type':office_mime,'X-Upload-Content-Length':str(len(data))}, location=True)
        # Validate Google's upload URL before putting a bearer token on it.
        return self.request(session, method='PUT', body=data, content_type=office_mime)



def settled_export(api,target,native,office):
    # Google may finish conversion and advance version during the first export.
    # Retry only reads, at most three times; never repeat upload/create.
    for attempt in range(3):
        before=api.metadata(target)
        if before.get('mimeType')!=native:
            raise BrandError('Output is not in the source native Google format.')
        returned=api.export(target,office)
        after=api.metadata(target)
        if all(before.get(k)==after.get(k) for k in ('version','modifiedTime')):
            return after,returned
    raise BrandError('Output kept changing during verification; review the existing copy.')


def verify_copy(api,source,target,remove_brand_shapes=None,icon_map=None,template_plan=None):
    from brand_ooxml import brand_office, content_manifest
    if source==target:raise BrandError('Verification target must be a separate copy.')
    meta=api.metadata(source)
    native=meta.get('mimeType')
    if native not in FORMATS:raise BrandError('Source must be native Google Slides or Docs.')
    kind,office=FORMATS[native]
    _,original=settled_export(api,source,native,office)
    check,returned=settled_export(api,target,native,office)
    expected,_,_=brand_office(original,remove_brand_shapes=remove_brand_shapes,icon_map=icon_map,template_plan=template_plan)
    equal=content_manifest(expected)==content_manifest(returned)
    return {'status':'verified' if equal else 'incomplete','file_id':target,'url':check.get('webViewLink'),
            'format':kind,'content_verified':equal,'verification':'Content matches the branded package; visual review remains required.'}


def brand(api, source, *, tidy=False, dry_run=False, folder=None, progress=None, remove_brand_shapes=None, preview=None, name=None, review=False, run_dir=None, icon_map=None, template_plan=None):
    from brand_ooxml import BRAND, brand_office, content_manifest
    started=time.monotonic();timings={};active=[None,started]
    def stage(name):
        now=time.monotonic()
        if active[0]:timings[active[0]]=round(now-active[1],2)
        active[:]=[name,now]
        if name and progress:progress({'status':'progress','stage':name,'elapsed_seconds':round(now-started,2)})
    def completed(result):
        stage(None);result.update(elapsed_seconds=round(time.monotonic()-started,2),timings_seconds=timings)
        return result
    def artifact(name,data):
        if run_dir is None:return None
        directory=Path(run_dir);directory.mkdir(parents=True,exist_ok=True)
        path=directory/name;path.write_bytes(data);return str(path.resolve())
    stage('exporting_source')
    meta=api.metadata(source)
    native=meta.get('mimeType')
    if native not in FORMATS:
        raise BrandError('Only native Google Slides and Google Docs are accepted.')
    if meta.get('trashed') or any(meta.get('capabilities',{}).get(k) is False for k in ('canCopy','canDownload')):
        raise BrandError('The source cannot be copied/exported.')
    kind,office=FORMATS[native]
    original=api.export(source,office)
    # Refuse a source that changed during export. No source mutation ever occurs.
    fresh=api.metadata(source)
    if any(meta.get(k)!=fresh.get(k) for k in ('version','modifiedTime','mimeType')):
        raise BrandError('Source changed during export; no output created. Retry from a fresh snapshot.')
    extension='.pptx' if kind=='slides' else '.docx'
    source_file=artifact('source'+extension,original)
    stage('applying_brand')
    compliance={}
    branded,changes,warnings=brand_office(original,tidy,remove_brand_shapes,compliance,icon_map=icon_map,template_plan=template_plan)
    if kind=='docs':
        warnings.append('Google Docs tabs and advanced features may be flattened by Word conversion; review the returned document.')
    result={'status':'preview' if dry_run else 'in_progress','name':name or branded_name(meta['name']),
            'format':kind,'brand':BRAND['name'],'tidy':tidy,'changes':changes,'warnings':warnings}
    if compliance:result['compliance']=compliance
    result['visual_review']='required'
    result['local_content_verified']=True
    if source_file:result['source_file']=source_file
    def retain_preview():
        path=artifact('branded'+extension,branded)
        if path:result['preview_file']=path
        if preview:
            Path(preview).write_bytes(branded);result['preview_file']=str(Path(preview).resolve())
    retain_preview()
    if review:
        if run_dir is None:raise BrandError('Visual review requires a private run directory.')
        stage('reviewing_original_and_branded')
        from visual_review import prepare,finish
        branded,state=prepare(branded,kind,compliance,Path(run_dir)/'visual',source_data=original)
        result['visual_review']=state
        retain_preview()
        if state['status'] in ('not_completed','regression_found'):
            result.update(status='review_incomplete',error=state.get('error','Branding introduced visual regressions; inspect the flagged pages in the saved preview.'))
            return completed(result)
        # A long visual review must not publish against a stale source revision.
        latest=api.metadata(source)
        if any(meta.get(k)!=latest.get(k) for k in ('version','modifiedTime','mimeType')):
            result.update(status='review_incomplete',error='Source changed during visual review; no copy created.')
            return completed(result)
    if dry_run:
        if review:
            result['visual_review']=finish(branded,kind,compliance,result['visual_review'],Path(run_dir)/'visual')
            if result['visual_review']['status'] in ('not_completed','regression_found'):result['status']='review_incomplete'
        return completed(result)
    stage('creating_native_copy')
    expected=content_manifest(branded)
    output=api.import_native(branded,result['name'],native,office,folder)
    target=output.get('id')
    if not target or target==source:
        raise BrandError('Google did not return a distinct output ID. Inspect Drive before retrying.')
    result.update(file_id=target,url=output.get('webViewLink'))
    if progress:progress({'status':'copy_created','file_id':target,'url':result['url']})
    stage('verifying_native_copy')
    try:
        check,returned=settled_export(api,target,native,office)
        path=artifact('returned'+extension,returned)
        if path:result['returned_file']=path
        result['url']=check.get('webViewLink') or result['url']
        actual=content_manifest(returned)
        if actual!=expected:
            # Report which classes differ without returning private text.
            differences=[]
            if kind=='slides':
                a,b=expected['slides'],actual.get('slides',[])
                if len(a)!=len(b):differences.append('slide count')
                for i,(left,right) in enumerate(zip(a,b),1):
                    differences.extend(f'slide {i}: {key}' for key in left if left[key]!=right.get(key))
            else:
                differences=[k for k in expected if expected[k]!=actual.get(k)]
            raise BrandError('Google conversion changed checked content: '+', '.join(differences[:20])+'. Copy needs review; original is untouched.')
        if not result['url']:
            raise BrandError('Output URL is unavailable; inspect the output file ID.')
        if review:
            stage('checking_native_render')
            result['visual_review']=finish(returned,kind,compliance,result['visual_review'],Path(run_dir)/'visual')
        result.update(status='branded_with_exceptions' if compliance and not compliance.get('full_compliance',False) else 'branded',content_verified=True,
                      content_sha256=hashlib.sha256(json.dumps(expected,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),
                      elapsed_seconds=round(time.monotonic()-started,2))
        if review and result['visual_review']['status']!='passed':result['status']='branded_with_exceptions'
        if review and result['visual_review']['status'] in ('not_completed','regression_found'):result['status']='review_incomplete'
        return completed(result)
    except (BrandError,ValueError,OSError) as exc:
        result.update(status='incomplete',content_verified=False,error=str(exc))
        return completed(result)


def document(api, source, ident, *, output='both', folder=None, name=None, run_dir=None, progress=None, when=None, layout=None):
    """Flow a Google Doc or a local .docx into one of the brand's Word document templates."""
    from brand_config import BRAND, PROFILE
    from document_template import fill, returned, TemplateError
    catalog=BRAND.get('documents') or {}
    if ident not in catalog:
        raise BrandError(f"{BRAND['name']} has no document template {ident}."+(f" Choose {', '.join(sorted(catalog))}." if catalog else ' Its rebranding profile lists none.'))
    started=time.monotonic()
    def stage(label):
        if progress:progress({'status':'progress','stage':label,'elapsed_seconds':round(time.monotonic()-started,2)})
    stage('reading_source')
    local=Path(source).expanduser()
    if local.suffix.lower() in ('.docx','.md') and local.is_file():
        if local.suffix.lower()=='.md':
            from markdown_source import to_docx
            try:original=to_docx(local.read_text(encoding='utf-8'),local.parent)
            except ValueError as exc:raise BrandError(str(exc)) from None
        else:original=local.read_bytes()
        title=local.stem;origin=None
        if output!='word' and api is None:raise BrandError('A Google copy needs Google access.')
    else:
        origin=file_id(source);meta=api.metadata(origin);native=meta.get('mimeType')
        if FORMATS.get(native,('',))[0]!='docs':raise BrandError('A document template takes a Google Doc or a local .docx file.')
        if meta.get('trashed') or meta.get('capabilities',{}).get('canDownload') is False:raise BrandError('The source cannot be exported.')
        original=api.export(origin,FORMATS[native][1]);title=meta['name']
        fresh=api.metadata(origin)
        if any(meta.get(k)!=fresh.get(k) for k in ('version','modifiedTime')):raise BrandError('Source changed during export; no output created. Retry from a fresh snapshot.')
    directory=Path(run_dir);directory.mkdir(parents=True,exist_ok=True)
    (directory/'source.docx').write_bytes(original)
    stage('filling_template')
    template=(PROFILE/'documents'/catalog[ident]['file']).read_bytes()
    placed=None
    try:
        data,report,expected=fill(template,original,name=title,when=when,closing_from=(layout or {}).get('closing_from'))
        if layout is not None:
            from document_layout import apply, kept
            from brand_icons import library, paint
            def icon_png(icon):
                if icon not in library():raise TemplateError(f'The icon library has no icon {icon}.')
                return paint(library()[icon])
            stage('setting_layout')
            data,placed,words=apply(data,template,layout,icon_png)
            problems=returned(data,expected)+kept(data,words)
            if problems:raise TemplateError('The layout lost content: '+'; '.join(problems)+'. No output was written.')
    except TemplateError as exc:raise BrandError(str(exc)) from None
    # Name the brand in the result: the same source is often put into several brands' templates.
    final=name or (title if title.endswith(f"-{BRAND['id']}-branded") else f"{title}-{BRAND['id']}-branded")
    result={'status':'branded','name':final,'format':'docs','brand':BRAND['name'],'document':{'id':ident,'name':catalog[ident].get('name',ident)},
            'template_fill':report,'outputs':{},'source_file':str((directory/'source.docx').resolve()),'local_content_verified':True,'visual_review':'required',
            'warnings':['Open the Word file and update the table of contents; check page breaks, picture sizes and anything listed as not carried.']}
    if catalog[ident].get('official') is False:
        result['warnings'].append(f"This template was derived from another brand's design and is not an official {BRAND['name']} template; check with the brand team before external use.")
    if output in ('word','both'):
        path=directory/(re.sub(r'[^A-Za-z0-9 ._()-]+','-',final).strip() or 'document')
        path=path.with_name(path.name+'.docx');path.write_bytes(data);result['outputs']['word']=str(path.resolve());result['preview_file']=str(path.resolve())
        if placed is not None:
            from document_pages import page_texts, locate
            stage('rendering_pages')
            pdf=path.with_suffix('.pdf');pages=page_texts(path,pdf)
            if pages is None:
                result['layout']={**placed,'rendered':False}
                result['warnings'].append('LibreOffice or pdftotext was not found, so the pages were not rendered: where the sidebars and page breaks fall is unchecked.')
            else:
                result['layout']={**placed,'rendered':True,**locate(pages,report,layout)};result['outputs']['pdf']=str(pdf.resolve())
                if result['layout']['sidebars_sharing_a_page']:
                    result['warnings'].append('Two sidebars landed on page '+', '.join(map(str,result['layout']['sidebars_sharing_a_page']))+' and will overlap; move one to a later heading or add a page break.')
    if output in ('google','both'):
        stage('creating_native_copy')
        native='application/vnd.google-apps.document';office=FORMATS[native][1]
        made=api.import_native(data,final,native,office,folder);target=made.get('id')
        if not target or target==origin:raise BrandError('Google did not return a distinct output ID. Inspect Drive before retrying.')
        result.update(file_id=target,url=made.get('webViewLink'));result['outputs']['google']=made.get('webViewLink')
        if progress:progress({'status':'copy_created','file_id':target,'url':made.get('webViewLink')})
        stage('verifying_native_copy')
        check,back=settled_export(api,target,native,office)
        (directory/'returned.docx').write_bytes(back);result['returned_file']=str((directory/'returned.docx').resolve())
        problems=returned(back,expected)
        result['content_verified']=not problems
        if problems:result.update(status='incomplete',error='Google conversion changed checked content: '+'; '.join(problems)+'. The Word file is complete; review the Google copy.')
        result['warnings'].append("Google Docs keeps the words, styles, tables and pictures but not Word's page design exactly: the cover artwork, headers and footers can shift. The Word file is the faithful one.")
    result['elapsed_seconds']=round(time.monotonic()-started,2)
    return result


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--brand',help='Explicit installed brand ID; required unless provided by a brand shortcut')
    parser.add_argument('source',help='Google Slides/Docs URL or Drive file ID; with --document, also a local .docx or .md file')
    parser.add_argument('--document',help="Flow the source into one of the brand's Word document templates, by ID (for example white-paper-tech)")
    parser.add_argument('--output',choices=('word','google','both'),default='both',help='With --document: a Word file, a Google Doc, or both (default)')
    parser.add_argument('--layout',help='With --document: a JSON file naming what goes in the template\'s sidebars, icon row and page breaks; see references/rebranding.md')
    parser.add_argument('--preview',help='Save the locally branded PPTX/DOCX for visual review (combine with --dry-run)')
    parser.add_argument('--template-plan',help='Inspected slide roles and text shape IDs; see references/template-alignment.md')
    parser.add_argument('--icon-map',help='JSON map of inspected functional icons to bundled icon IDs; see references/icons.md')
    parser.add_argument('--name',help='Explicit output name; default: original-branded')
    parser.add_argument('--remove-brand-shape',action='append',default=[],help='Inspected old logo artwork: SLIDE_NUMBER:EXACT_SHAPE_NAME; repeatable')
    parser.add_argument('--tidy',action='store_true',help='Normalize document paragraph spacing; no redesign')
    parser.add_argument('--dry-run',action='store_true',help='Read/plan without creating output')
    parser.add_argument('--folder',type=file_id,help='Output folder; default: personal My Drive root')
    parser.add_argument('--verify-copy',type=file_id,help='Recheck an existing output against the source; read-only, no new copy')
    parser.add_argument('--review',action='store_true',help='Read-only visual review by the calling agent harness, and one bounded Slides repair batch')
    parser.add_argument('--reviewer',choices=('auto','claude','codex'),default='auto',help='Harness that reviews with --review; auto is the one this command was called from')
    parser.add_argument('--run-dir',help='New private directory for readable reports and review artifacts; defaults to a new folder in rebrand-runs/ beside the installed Harness Brand (runs/ in a checkout)')
    parser.add_argument('--account',help='Existing gcloud account; does not switch the active account')
    args=parser.parse_args(argv)
    run_dir=None;owns_run=False
    try:
        if args.brand:os.environ['HARNESS_REBRAND_BRAND']=args.brand
        from brand_config import ASSET_VERSION  # Fails before any Google access.
        local_source=bool(args.document) and Path(args.source).expanduser().suffix.lower() in ('.docx','.md') and Path(args.source).expanduser().is_file()
        source=args.source if local_source else file_id(args.source)
        if args.document and (args.review or args.verify_copy or args.template_plan or args.dry_run):raise BrandError('--document does not combine with --review, --verify-copy, --template-plan or --dry-run.')
        if args.layout and not args.document:raise BrandError('--layout needs --document.')
        if args.layout and args.output=='google':raise BrandError('--layout needs a Word file: use --output word or both.')
        layout=json.loads(Path(args.layout).read_text()) if args.layout else None
        template_plan=json.loads(Path(args.template_plan).read_text()) if args.template_plan else None
        icon_map=json.loads(Path(args.icon_map).read_text()) if args.icon_map else None
        if args.verify_copy and args.review:raise BrandError('--verify-copy is content-only; use visual_review.py to review an exported copy.')
        import tempfile
        if args.run_dir:
            run_dir=Path(args.run_dir).resolve()
            if run_dir.exists() and any(run_dir.iterdir()):raise BrandError('Use a new empty run directory; existing runs are never overwritten or republished.')
            run_dir.mkdir(parents=True,exist_ok=True,mode=0o700)
        else:
            from brand_assets import runs_folder
            base=runs_folder();base.mkdir(parents=True,exist_ok=True)
            run_dir=Path(tempfile.mkdtemp(prefix='brand-',dir=base))
        owns_run=True
        if args.review:
            from visual_review import preflight
            preflight(args.reviewer)
        api=None if (local_source and args.output=='word') else Drive(args.account)
        if args.document:
            def progress(event):
                if event.get('status')=='copy_created':(run_dir/'checkpoint.json').write_text(json.dumps(event))
                print(json.dumps(event),file=sys.stderr,flush=True)
            result=document(api,source,args.document,output=args.output,folder=args.folder,name=args.name,run_dir=run_dir,progress=progress,layout=layout)
        elif args.verify_copy:
            result=verify_copy(api,source,args.verify_copy,args.remove_brand_shape,icon_map,template_plan)
        else:
            def progress(event):
                if event.get('status')=='copy_created':(run_dir/'checkpoint.json').write_text(json.dumps(event))
                print(json.dumps(event),file=sys.stderr,flush=True)
            result=brand(api,source,tidy=args.tidy,dry_run=args.dry_run,folder=args.folder,
                         remove_brand_shapes=args.remove_brand_shape,preview=args.preview,name=args.name,review=args.review,run_dir=run_dir,
                         progress=progress,icon_map=icon_map,template_plan=template_plan)
        from reporting import save
        save(result,run_dir)
        print(json.dumps(result,indent=2))
        return 0 if result['status'] in ('branded','branded_with_exceptions','preview','verified') else 1
    except (BrandError,ValueError,OSError,subprocess.SubprocessError) as exc:
        result={'status':'error','error':str(exc)}
        if owns_run:
            checkpoint=run_dir/'checkpoint.json'
            if checkpoint.exists():result.update(json.loads(checkpoint.read_text()),status='incomplete',error=str(exc))
            from reporting import save
            save(result,run_dir)
        print(json.dumps(result),file=sys.stderr)
        return 1


if __name__=='__main__':
    venv=Path(__file__).resolve().parents[1]/'.venv/bin/python3'
    if venv.exists() and Path(sys.prefix).resolve()!=venv.parent.parent.resolve():
        os.execv(str(venv),[str(venv),__file__,*sys.argv[1:]])
    try:
        import pptx,docx
    except ImportError:
        from brand_assets import setup_command
        sys.exit(f'The private formatting runtime is not set up for this version of Harness Brand. Set it up with: {setup_command()}')
    sys.exit(main())
