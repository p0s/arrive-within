#!/usr/bin/env python3
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_physical_report import main
raise SystemExit(main('garden-hero', 'en-US', '0e051326-9fa8-55e6-8070-62449c9a3205'))
