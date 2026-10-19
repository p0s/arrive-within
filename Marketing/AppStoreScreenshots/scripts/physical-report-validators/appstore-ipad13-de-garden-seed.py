#!/usr/bin/env python3
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_physical_report import main
raise SystemExit(main('garden-seed', 'de-DE', 'f5dd9b46-98bd-52d0-a4f2-f207179daeb9'))
