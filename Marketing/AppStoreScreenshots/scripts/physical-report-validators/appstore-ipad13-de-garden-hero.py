#!/usr/bin/env python3
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_physical_report import main
raise SystemExit(main('garden-hero', 'de-DE', '3f6e225e-f72e-59b1-9d1c-f4978557fdd6'))
