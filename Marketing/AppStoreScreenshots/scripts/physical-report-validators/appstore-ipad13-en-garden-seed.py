#!/usr/bin/env python3
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_physical_report import main
raise SystemExit(main('garden-seed', 'en-US', '32573d67-6eb3-5806-871c-693679d46712'))
