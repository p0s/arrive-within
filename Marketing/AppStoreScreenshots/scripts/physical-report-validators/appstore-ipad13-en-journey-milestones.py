#!/usr/bin/env python3
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_physical_report import main
raise SystemExit(main('journey-milestones', 'en-US', '156997c1-d601-5731-b66a-a948736ab51d'))
