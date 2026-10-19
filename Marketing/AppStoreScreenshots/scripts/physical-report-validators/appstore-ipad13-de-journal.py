#!/usr/bin/env python3
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_physical_report import main
raise SystemExit(main('journal', 'de-DE', 'e1beab35-f330-5804-bea9-4fa04e961a68'))
