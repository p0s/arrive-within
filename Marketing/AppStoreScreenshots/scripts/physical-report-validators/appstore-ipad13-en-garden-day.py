#!/usr/bin/env python3
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_physical_report import main
raise SystemExit(main('garden-day', 'en-US', 'f8ad0a65-2e16-5889-bd2d-bcdf1c19355e'))
