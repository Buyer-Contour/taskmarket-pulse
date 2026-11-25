from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

public = Path(__file__).resolve().parents[1] / "public"
serif = ImageFont.truetype(str(public / "InstrumentSerif-Regular.ttf"), 112)
sans = ImageFont.truetype(str(public / "InterTight-Variable.ttf"), 29)
cream, pink, salmon, muted = "#fff6e8", "#e74079", "#d9a097", "#b0a79d"

for key, title, line, label in [
    ("trends", "Market trends.", "Agents, tasks and rewards over time", "01 / FLOW"),
    ("participation", "Who posts work?", "One-time and repeat demand, week by week", "02 / PARTICIPATION"),
    ("activity", "Market activity.", "The weekly rhythm and latest events", "03 / ACTIVITY"),
]:
    img = Image.new("RGB", (1200, 630), "#12100e")
    d = ImageDraw.Draw(img)
    d.rectangle((42, 42, 1158, 588), outline="#774054", width=2)
    d.rectangle((44, 44, 1156, 146), fill="#3a1420")
    d.ellipse((76, 88, 89, 101), fill=pink)
    d.text((105, 74), "TASKMARKET PULSE  /  " + label, font=sans, fill=salmon)
    d.text((76, 190), title, font=serif, fill=cream)
    d.text((82, 365), line, font=sans, fill=muted)
    d.line((81, 475, 1119, 475), fill="#774054", width=2)
    d.text((82, 516), "BuyerContour   /   TEMPO + BASE", font=sans, fill=salmon)
    img.save(public / f"share-{key}.png", optimize=True)
