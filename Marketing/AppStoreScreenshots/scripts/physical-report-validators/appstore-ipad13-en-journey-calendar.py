#!/usr/bin/env python3
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_physical_report import main
raise SystemExit(main('journey-calendar', 'en-US', '9f9faeef-7512-5284-af37-f60d101b1de7'))
