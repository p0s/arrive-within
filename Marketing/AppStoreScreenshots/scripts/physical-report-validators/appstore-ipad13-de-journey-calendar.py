#!/usr/bin/env python3
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_physical_report import main
raise SystemExit(main('journey-calendar', 'de-DE', '27726e22-82a8-59fa-8438-d69b9616fe82'))
