#!/usr/bin/env python3
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_physical_report import main
raise SystemExit(main('journey-milestones', 'de-DE', '6ba425b5-28af-55bc-be7b-d2694556702a'))
