#!/usr/bin/env python3
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_physical_report import main
raise SystemExit(main('garden-day', 'de-DE', 'cd0319d2-674a-5ba7-9a5f-6717e2d41bfc'))
