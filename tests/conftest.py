"""Make imports deterministic: package parent dir (for `astrbot_douyin_agent`)
and tests/ itself (for sibling test-module imports like `test_processing_regressions`).

Note: this relies on the repo directory being NAMED astrbot_douyin_agent (true
for local clones). CI checkouts use a different directory name, so CI exposes
the package via a symlink (workspace -> /tmp/astrbot_douyin_agent) plus
PYTHONPATH=/tmp instead -- see .gitea/workflows/deploy.yml.
"""
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
for p in (str(_HERE.parent.parent), str(_HERE)):
    if p not in sys.path:
        sys.path.insert(0, p)
