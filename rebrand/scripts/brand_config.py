"""Brand data from the skill's verified, locked local snapshot."""
import json
from pathlib import Path
from brand_assets import installed, read_lock
ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = installed(ROOT)
BRAND = json.loads((SNAPSHOT / 'assets/brand.json').read_text())
PROFILE = SNAPSHOT / BRAND['profile']
RULES = BRAND['runtime']
ICON_LIBRARY = SNAPSHOT / 'assets/icons/library.zip'
REVIEW_GUIDE = SNAPSHOT / 'references/visual-review.md'
ASSET_VERSION = {key: value for key, value in read_lock(ROOT).items() if key in ('brand', 'source', 'revision', 'sha256')}

ASSET_VERSION['engine'] = json.loads((ROOT.parent / 'package.json').read_text())['version']
