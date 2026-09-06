"""Country manifest for the global Overture places extraction.

Every entry: iso2 (file stem), name, aliases (for query→file routing),
bbox (xmin, ymin, xmax, ymax — rough; rows are post-filtered by Overture's
own address country code), tier → row cap.

Tiers (confidence ≥ 0.6 rows, JSONL ≈ 0.8 KB/row):
  mega   2,000,000   — single-country-scale markets
  large    400,000   — big economies / big POI density
  medium   130,000
  small     45,000
Capped countries are extracted with a 2°-tile grid so rows spread across the
whole country (a single-bbox LIMIT scan returns "first rows read" — clustered,
e.g. the US cap landing on one corner of the country). The tiled per-country
budget lands ≈ 13 GB JSONL for all 90 countries.
"""
from __future__ import annotations

from dataclasses import dataclass

TIER_CAPS = {"mega": 2_000_000, "large": 400_000, "medium": 130_000, "small": 45_000}


@dataclass(frozen=True)
class Country:
    iso2: str
    name: str
    region: str  # europe | asia | middle_east | americas_n | americas_s | africa | oceania
    bbox: tuple[float, float, float, float]
    tier: str
    aliases: tuple[str, ...] = ()

    @property
    def cap(self) -> int:
        return TIER_CAPS[self.tier]

    @property
    def file_stem(self) -> str:
        return self.iso2.lower()


# (iso2, name, region, bbox, tier, aliases)
_C = [
    # ── Europe ──────────────────────────────────────────────────────────────
    ("GB", "United Kingdom", "europe", (-8.2, 49.9, 1.8, 60.9), "large", ("uk", "britain", "england", "scotland", "wales", "london", "manchester", "birmingham", "edinburgh", "glasgow", "leeds", "bristol")),
    ("DE", "Germany", "europe", (5.8, 47.2, 15.1, 55.1), "large", ("germany", "deutschland", "berlin", "munich", "hamburg", "frankfurt", "cologne", "stuttgart", "düsseldorf")),
    ("FR", "France", "europe", (-5.3, 41.2, 9.7, 51.2), "large", ("france", "paris", "lyon", "marseille", "toulouse", "nice", "bordeaux")),
    ("IT", "Italy", "europe", (6.6, 36.6, 18.6, 47.1), "large", ("italy", "italia", "rome", "milan", "naples", "turin", "florence")),
    ("ES", "Spain", "europe", (-9.4, 35.9, 3.4, 43.8), "large", ("spain", "españa", "madrid", "barcelona", "valencia", "seville")),
    ("NL", "Netherlands", "europe", (3.3, 50.7, 7.3, 53.6), "medium", ("netherlands", "holland", "amsterdam", "rotterdam", "utrecht", "eindhoven")),
    ("BE", "Belgium", "europe", (2.5, 49.4, 6.4, 51.5), "medium", ("belgium", "brussels", "antwerp", "bruges")),
    ("PT", "Portugal", "europe", (-9.6, 36.9, -6.2, 42.2), "medium", ("portugal", "lisbon", "lisboa", "porto")),
    ("PL", "Poland", "europe", (14.1, 49.0, 24.2, 54.9), "medium", ("poland", "polska", "warsaw", "krakow", "wroclaw")),
    ("SE", "Sweden", "europe", (10.9, 55.3, 24.2, 69.1), "medium", ("sweden", "sverige", "stockholm", "gothenburg", "malmo")),
    ("NO", "Norway", "europe", (4.5, 57.9, 31.2, 71.3), "medium", ("norway", "oslo", "bergen")),
    ("DK", "Denmark", "europe", (8.0, 54.5, 12.8, 57.8), "medium", ("denmark", "danmark", "copenhagen", "aarhus")),
    ("FI", "Finland", "europe", (20.4, 59.7, 31.6, 70.1), "medium", ("finland", "suomi", "helsinki", "espoo")),
    ("IE", "Ireland", "europe", (-10.6, 51.3, -5.9, 55.4), "medium", ("ireland", "dublin", "cork", "eire")),
    ("AT", "Austria", "europe", (9.5, 46.3, 17.2, 49.0), "medium", ("austria", "vienna", "wien", "salzburg")),
    ("CH", "Switzerland", "europe", (5.9, 45.8, 10.6, 47.9), "medium", ("switzerland", "zurich", "geneva", "basel", "bern")),
    ("CZ", "Czechia", "europe", (12.0, 48.5, 18.9, 51.1), "medium", ("czech republic", "czechia", "prague", "brno")),
    ("GR", "Greece", "europe", (19.3, 34.8, 28.3, 41.8), "medium", ("greece", "athens", "thessaloniki")),
    ("RO", "Romania", "europe", (20.2, 43.6, 29.7, 48.3), "medium", ("romania", "bucharest", "cluj")),
    ("HU", "Hungary", "europe", (16.1, 45.7, 22.9, 48.6), "medium", ("hungary", "budapest")),
    ("UA", "Ukraine", "europe", (22.1, 44.3, 40.2, 52.4), "medium", ("ukraine", "kyiv", "kiev")),
    ("SK", "Slovakia", "europe", (16.8, 47.7, 22.6, 49.6), "small", ("slovakia", "bratislava")),
    ("SI", "Slovenia", "europe", (13.3, 45.4, 16.6, 46.9), "small", ("slovenia", "ljubljana")),
    ("HR", "Croatia", "europe", (13.4, 42.4, 19.4, 46.6), "small", ("croatia", "zagreb", "split")),
    ("BG", "Bulgaria", "europe", (22.3, 41.2, 28.6, 44.2), "small", ("bulgaria", "sofia")),
    ("RS", "Serbia", "europe", (18.8, 42.2, 23.0, 46.2), "small", ("serbia", "belgrade")),
    ("LT", "Lithuania", "europe", (20.6, 53.9, 26.9, 56.5), "small", ("lithuania", "vilnius")),
    ("LV", "Latvia", "europe", (20.9, 55.6, 28.3, 58.1), "small", ("latvia", "riga")),
    ("EE", "Estonia", "europe", (21.7, 57.5, 28.2, 59.7), "small", ("estonia", "tallinn")),
    ("IS", "Iceland", "europe", (-25.0, 63.3, -13.5, 66.6), "small", ("iceland", "reykjavik")),
    ("LU", "Luxembourg", "europe", (5.7, 49.4, 6.6, 50.2), "small", ("luxembourg")),
    ("MT", "Malta", "europe", (14.1, 35.7, 14.6, 36.1), "small", ("malta", "valletta")),
    ("CY", "Cyprus", "europe", (32.2, 34.5, 34.7, 35.7), "small", ("cyprus", "nicosia", "limassol")),
    # ── Middle East ─────────────────────────────────────────────────────────
    ("AE", "United Arab Emirates", "middle_east", (51.5, 22.6, 56.4, 26.1), "medium", ("uae", "dubai", "abu dhabi", "sharjah", "emirates")),
    ("SA", "Saudi Arabia", "middle_east", (34.5, 16.0, 56.0, 32.2), "medium", ("saudi arabia", "ksa", "riyadh", "jeddah", "dammam")),
    ("IL", "Israel", "middle_east", (34.2, 29.4, 35.9, 33.3), "medium", ("israel", "tel aviv", "jerusalem", "haifa")),
    ("QA", "Qatar", "middle_east", (50.7, 24.5, 52.0, 26.2), "small", ("qatar", "doha")),
    ("KW", "Kuwait", "middle_east", (46.5, 28.5, 48.8, 30.1), "small", ("kuwait")),
    ("BH", "Bahrain", "middle_east", (50.4, 25.5, 50.9, 26.4), "small", ("bahrain", "manama")),
    ("OM", "Oman", "middle_east", (51.8, 16.6, 60.0, 26.5), "small", ("oman", "muscat")),
    ("JO", "Jordan", "middle_east", (34.9, 29.1, 39.3, 32.7), "small", ("jordan", "amman")),
    ("LB", "Lebanon", "middle_east", (35.0, 33.0, 36.6, 34.7), "small", ("lebanon", "beirut")),
    ("TR", "Türkiye", "middle_east", (25.6, 35.8, 45.0, 42.2), "large", ("turkey", "turkiye", "istanbul", "ankara", "izmir", "antalya")),
    # ── Asia ────────────────────────────────────────────────────────────────
    ("IN", "India", "asia", (68.1, 6.7, 97.4, 35.5), "mega", ("india", "bharat", "mumbai", "delhi", "bangalore", "bengaluru", "hyderabad", "chennai", "pune", "kolkata")),
    ("JP", "Japan", "asia", (122.9, 24.2, 145.9, 45.6), "large", ("japan", "tokyo", "osaka", "kyoto", "yokohama", "nagoya")),
    ("SG", "Singapore", "asia", (103.6, 1.1, 104.2, 1.5), "medium", ("singapore")),
    ("ID", "Indonesia", "asia", (94.9, -11.2, 141.1, 6.3), "large", ("indonesia", "jakarta", "surabaya", "bali")),
    ("TH", "Thailand", "asia", (97.3, 5.6, 105.7, 20.5), "medium", ("thailand", "bangkok", "phuket", "chiang mai")),
    ("MY", "Malaysia", "asia", (99.6, 0.8, 119.3, 7.4), "medium", ("malaysia", "kuala lumpur", "penang", "johor")),
    ("PH", "Philippines", "asia", (116.9, 4.6, 126.6, 19.0), "medium", ("philippines", "manila", "cebu")),
    ("VN", "Vietnam", "asia", (102.1, 8.2, 109.6, 23.4), "medium", ("vietnam", "ho chi minh", "hanoi", "saigon")),
    ("PK", "Pakistan", "asia", (60.9, 23.7, 77.8, 37.1), "medium", ("pakistan", "karachi", "lahore", "islamabad")),
    ("BD", "Bangladesh", "asia", (88.0, 20.6, 92.7, 26.6), "medium", ("bangladesh", "dhaka", "chittagong")),
    ("KR", "South Korea", "asia", (124.6, 33.1, 131.9, 38.7), "medium", ("south korea", "korea", "seoul", "busan")),
    ("HK", "Hong Kong", "asia", (113.8, 22.1, 114.5, 22.6), "small", ("hong kong")),
    ("TW", "Taiwan", "asia", (119.9, 21.8, 122.1, 25.4), "small", ("taiwan", "taipei")),
    ("LK", "Sri Lanka", "asia", (79.5, 5.9, 82.0, 10.0), "small", ("sri lanka", "colombo")),
    ("NP", "Nepal", "asia", (80.0, 26.3, 88.2, 30.5), "small", ("nepal", "kathmandu")),
    ("KZ", "Kazakhstan", "asia", (46.4, 40.5, 87.4, 55.5), "small", ("kazakhstan", "almaty", "astana")),
    ("UZ", "Uzbekistan", "asia", (55.9, 37.1, 73.2, 45.6), "small", ("uzbekistan", "tashkent")),
    ("GE", "Georgia", "asia", (39.9, 41.0, 46.8, 43.6), "small", ("georgia", "tbilisi")),
    ("AZ", "Azerbaijan", "asia", (44.7, 38.3, 50.4, 41.9), "small", ("azerbaijan", "baku")),
    ("AM", "Armenia", "asia", (43.4, 38.8, 46.7, 41.3), "small", ("armenia", "yerevan")),
    # ── North America ───────────────────────────────────────────────────────
    ("US", "United States", "americas_n", (-125.0, 24.0, -66.5, 49.6), "mega", ("usa", "united states", "america", "new york", "los angeles", "chicago", "houston", "austin", "miami", "san francisco", "seattle", "boston", "dallas", "denver", "atlanta")),
    ("CA", "Canada", "americas_n", (-141.0, 41.6, -52.6, 70.0), "large", ("canada", "toronto", "vancouver", "montreal", "calgary", "ottawa")),
    ("MX", "Mexico", "americas_n", (-117.2, 14.5, -86.7, 32.7), "large", ("mexico", "mexico city", "guadalajara", "monterrey", "cancun")),
    # ── Central America & Caribbean ─────────────────────────────────────────
    ("CR", "Costa Rica", "americas_n", (-85.9, 8.0, -82.5, 11.2), "small", ("costa rica", "san jose")),
    ("PA", "Panama", "americas_n", (-83.1, 7.2, -77.2, 9.7), "small", ("panama")),
    ("GT", "Guatemala", "americas_n", (-92.3, 13.7, -88.2, 17.8), "small", ("guatemala")),
    ("DO", "Dominican Republic", "americas_n", (-72.0, 17.5, -68.3, 19.9), "small", ("dominican republic", "santo domingo")),
    ("PR", "Puerto Rico", "americas_n", (-67.3, 17.9, -65.2, 18.5), "small", ("puerto rico", "san juan")),
    # ── South America ───────────────────────────────────────────────────────
    ("BR", "Brazil", "americas_s", (-74.1, -33.9, -32.4, 5.4), "mega", ("brazil", "brasil", "sao paulo", "rio de janeiro", "belo horizonte", "brasilia")),
    ("AR", "Argentina", "americas_s", (-73.6, -55.1, -53.6, -21.8), "large", ("argentina", "buenos aires", "cordoba")),
    ("CL", "Chile", "americas_s", (-75.7, -56.0, -66.4, -17.5), "medium", ("chile", "santiago")),
    ("CO", "Colombia", "americas_s", (-79.0, -4.3, -66.9, 12.5), "medium", ("colombia", "bogota", "medellin")),
    ("PE", "Peru", "americas_s", (-81.4, -18.4, -68.7, -0.0), "medium", ("peru", "lima")),
    ("UY", "Uruguay", "americas_s", (-58.5, -35.0, -53.2, -30.1), "small", ("uruguay", "montevideo")),
    ("EC", "Ecuador", "americas_s", (-81.1, -5.0, -75.2, 1.5), "small", ("ecuador", "quito", "guayaquil")),
    ("BO", "Bolivia", "americas_s", (-69.7, -22.9, -57.5, -9.7), "small", ("bolivia", "la paz")),
    ("PY", "Paraguay", "americas_s", (-62.7, -27.6, -54.3, -19.3), "small", ("paraguay", "asuncion")),
    # ── Africa ──────────────────────────────────────────────────────────────
    ("ZA", "South Africa", "africa", (16.4, -34.9, 32.9, -22.1), "medium", ("south africa", "cape town", "johannesburg", "durban", "pretoria")),
    ("EG", "Egypt", "africa", (24.6, 22.0, 37.3, 31.7), "medium", ("egypt", "cairo", "alexandria")),
    ("NG", "Nigeria", "africa", (2.7, 4.2, 14.7, 13.9), "medium", ("nigeria", "lagos", "abuja")),
    ("KE", "Kenya", "africa", (33.9, -4.7, 41.9, 5.0), "small", ("kenya", "nairobi")),
    ("MA", "Morocco", "africa", (-13.2, 27.6, -1.0, 35.9), "small", ("morocco", "casablanca", "marrakech")),
    ("GH", "Ghana", "africa", (-3.3, 4.7, 1.2, 11.2), "small", ("ghana", "accra")),
    ("TZ", "Tanzania", "africa", (29.3, -11.8, 39.3, -0.9), "small", ("tanzania", "dar es salaam")),
    ("TN", "Tunisia", "africa", (7.5, 30.2, 11.6, 37.6), "small", ("tunisia", "tunis")),
    # ── Oceania ─────────────────────────────────────────────────────────────
    ("AU", "Australia", "oceania", (112.9, -44.0, 153.7, -10.6), "large", ("australia", "sydney", "melbourne", "brisbane", "perth", "adelaide")),
    ("NZ", "New Zealand", "oceania", (166.4, -47.3, 178.6, -34.3), "medium", ("new zealand", "nz", "auckland", "wellington", "christchurch")),
]

COUNTRIES: list[Country] = [Country(iso2, name, region, tuple(bbox), tier, tuple(aliases)) for iso2, name, region, bbox, tier, aliases in _C]

WAVE_1 = ["GB", "DE", "FR", "TR", "AE", "IL", "IN", "SG", "JP", "BR", "MX", "CA", "US", "AU", "ES", "IT"]


def by_iso(iso2: str) -> Country | None:
    iso = iso2.upper()
    return next((c for c in COUNTRIES if c.iso2 == iso), None)
