#!/usr/bin/env python3
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_physical_report import main
raise SystemExit(main('journal', 'en-US', '5f074d39-18bf-50aa-ae4e-18a6a5b577f8'))
