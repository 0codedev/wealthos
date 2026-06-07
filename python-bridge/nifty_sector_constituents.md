# NSE Sectoral Indices & F&O Constituent Status

This document provides a complete lookup of all Nifty index sectors and the corresponding active F&O constituent stocks mapped in the Wealth Dashboard v2. These lists are dynamically compiled by the Python bridge (`update_fno_universe.py`) on startup and served to the application.

---

## 📊 Sector Summary (Active F&O Counts)

| Sector / Index | Active F&O Count | Description | Primary Sources |
| :--- | :--- | :--- | :--- |
| **FIN SERVICE** | 47 | Financial Services & Insurance | `ind_niftyfinancelist.csv` + Static |
| **BANK** | 21 | Banking Sector (All) | `ind_niftybanklist.csv` + Static |
| **PVT BANK** | 15 | Private Sector Banks | `ind_niftyprivatebanklist.csv` + Static |
| **PSU BANK** | 13 | Public Sector Banks | `ind_niftypsubanklist.csv` + Static |
| **AUTO** | 24 | Automobiles & Auto Components | `ind_niftyautolist.csv` + Static |
| **FMCG** | 29 | Fast-Moving Consumer Goods | `ind_niftyfmcglist.csv` + Static |
| **OIL & GAS** | 23 | Energy, Oil, Gas & Power | `ind_niftyoilgaslist.csv` + Static |
| **IT** | 18 | Information Technology & Services | `ind_niftyitlist.csv` + Static |
| **HEALTHCARE** | 21 | Healthcare Facilities & Equipment | `ind_niftyhealthcarelist.csv` + Static |
| **PHARMA** | 17 | Pharmaceuticals | `ind_niftypharmalist.csv` + Static |
| **METAL** | 18 | Metals & Mining | `ind_niftymetallist.csv` + Static |
| **REALTY** | 15 | Real Estate Development | `ind_niftyrealtylist.csv` + Static |
| **CEMENT** | 12 | Cement & Building Materials | Static Baseline Mappings |
| **CAP GOODS** | 12 | Heavy Machinery & Capital Goods | Static Baseline Mappings |
| **SERVICES** | 11 | Transportation, Telecom & Logistics | Static Baseline Mappings |
| **DEFENSE** | 6 | Aerospace & Defense | Static Baseline Mappings |
| **MEDIA** | 10 | Media, Entertainment & Broadcasting | `ind_niftymedialist.csv` + Static |
| **CONSUMER DURABLES** | 12 | Electronics & Retail Durables | Static Baseline Mappings |
| **NIFTY 50** | 57 | Major Benchmark Index | `ind_nifty50list.csv` + Static |
| **SENSEX** | 30 | Major Benchmark Index | Static Baseline Mappings |
| **NIFTY NEXT 50** | 47 | Next 50 Bluechip Stocks | `ind_niftynext50list.csv` + Static |
| **NIFTY MID SELECT** | 61 | Midcap Benchmark Stocks | `ind_niftymidcap50list.csv` + Static |

---

## 🔍 Sector Constituent Details

### 🚗 NIFTY AUTO (24 Stocks)
*Includes major automobile manufacturers and auto ancillary units.*
> `APOLLOTYRE` | `ARE&M` | `ASHOKLEY` | `BAJAJ-AUTO` | `BALKRISIND` | `BHARATFORG` | `BOSCHLTD` | `CEAT` | `EICHERMOT` | `EXIDEIND` | `FORCEMOT` | `HEROMOTOCO` | `HYUNDAI` | `JKTYRE` | `M&M` | `MARUTI` | `MOTHERSON` | `MRF` | `SONACOMS` | `TATAMOTORS` | `TIINDIA` | `TMPV` | `TVSMOTOR` | `UNOMINDA`

### 🏦 NIFTY BANK (21 Stocks)
*Covers all active F&O public and private sector banks.*
> `AUBANK` | `AXISBANK` | `BANDHANBNK` | `BANKBARODA` | `BANKINDIA` | `CANBK` | `CUB` | `FEDERALBNK` | `HDFCBANK` | `ICICIBANK` | `IDFCFIRSTB` | `INDIANB` | `INDUSINDBK` | `KOTAKBANK` | `MAHABANK` | `PNB` | `RBLBANK` | `SBIN` | `UCOBANK` | `UNIONBANK` | `YESBANK`

### 🏢 NIFTY FIN SERVICE (47 Stocks)
*Financial service conglomerates, NBFCs, AMCs, and insurance companies.*
> `360ONE` | `ABCAPITAL` | `ANGELONE` | `AXISBANK` | `BAJAJFINSV` | `BAJAJHLDNG` | `BAJFINANCE` | `BSE` | `CDSL` | `CHOLAFIN` | `GICRE` | `HDFCAMC` | `HDFCBANK` | `HDFCLIFE` | `HUDCO` | `ICICIBANK` | `ICICIGI` | `ICICIPRULI` | `IEX` | `IREDA` | `IRFC` | `JIOFIN` | `KFINTECH` | `KOTAKBANK` | `LICHSGFIN` | `LICI` | `LTF` | `M&MFIN` | `MANAPPURAM` | `MCX` | `MFSL` | `MOTILALOFS` | `MUTHOOTFIN` | `NAM-INDIA` | `NIACL` | `NUVAMA` | `PAYTM` | `PEL` | `PFC` | `PNBHOUSING` | `POLICYBZR` | `RECLTD` | `SAMMAANCAP` | `SBICARD` | `SBILIFE` | `SBIN` | `SHRIRAMFIN`

### 💻 NIFTY IT (18 Stocks)
*Major software and technology services exporters.*
> `BSOFT` | `CAMS` | `COFORGE` | `CYIENT` | `HCLTECH` | `INFY` | `KAYNES` | `KPITTECH` | `LTM` | `LTTS` | `MPHASIS` | `OFSS` | `PERSISTENT` | `SONATSOFTW` | `TATAELXSI` | `TCS` | `TECHM` | `WIPRO`

### 🛒 NIFTY FMCG (29 Stocks)
*Fast-moving consumer goods, retail chains, and food services.*
> `BALRAMCHIN` | `BRITANNIA` | `COLPAL` | `DABUR` | `DEVYANI` | `DMART` | `EMAMILTD` | `ETERNAL` | `GODFRYPHLP` | `GODREJCP` | `GODREJIND` | `HINDUNILVR` | `ITC` | `JUBLFOOD` | `MARICO` | `NESTLEIND` | `NYKAA` | `PAGEIND` | `PATANJALI` | `RADICO` | `SAPPHIRE` | `SWIGGY` | `TATACOMM` | `TATACONSUM` | `TRENT` | `UBL` | `UNITDSPR` | `VBL` | `VMM`

### 🛢️ NIFTY OIL & GAS (23 Stocks)
*Energy conglomerates, petroleum refineries, city gas distributors, and power grids.*
> `ADANIENSOL` | `ADANIGREEN` | `ADANIPOWER` | `BPCL` | `CESC` | `COALINDIA` | `GAIL` | `GUJGASLTD` | `HINDPETRO` | `IGL` | `IOC` | `JSWENERGY` | `MGL` | `NHPC` | `NTPC` | `OIL` | `ONGC` | `PETRONET` | `POWERGRID` | `RELIANCE` | `SJVN` | `SUZLON` | `TATAPOWER`

### 🧪 NIFTY PHARMA (17 Stocks)
*Pure-play pharmaceutical and drug manufacturers.*
> `ABBOTINDIA` | `ALKEM` | `AUROPHARMA` | `BIOCON` | `CIPLA` | `DIVISLAB` | `DRREDDY` | `GLENMARK` | `GRANULES` | `IPCALAB` | `LAURUSLABS` | `LUPIN` | `MANKIND` | `NATCOPHARM` | `SUNPHARMA` | `TORNTPHARM` | `ZYDUSLIFE`

### 🏥 NIFTY HEALTHCARE (21 Stocks)
*Hospitals, medical labs, diagnostics, and integrated pharma units.*
> `ALKEM` | `APOLLOHOSP` | `AUROPHARMA` | `BIOCON` | `CIPLA` | `DIVISLAB` | `DRREDDY` | `FORTIS` | `GLENMARK` | `KIMS` | `LALPATHLAB` | `LAURUSLABS` | `LUPIN` | `MANKIND` | `MAXHEALTH` | `METROPOLIS` | `PPLPHARMA` | `SUNPHARMA` | `SYNGENE` | `TORNTPHARM` | `ZYDUSLIFE`

### 🏗️ NIFTY METAL (18 Stocks)
*Steel producers, non-ferrous metal miners, and forging companies.*
> `ADANIENT` | `APLAPOLLO` | `BHARATFORG` | `HINDALCO` | `HINDCOPPER` | `HINDZINC` | `JINDALSTEL` | `JSL` | `JSWSTEEL` | `NATIONALUM` | `NMDC` | `PIIND` | `SAIL` | `SRF` | `TATASTEEL` | `UPL` | `VEDL` | `WELCORP`

### 🏢 NIFTY REALTY (15 Stocks)
*Residential and commercial real estate developers.*
> `ASHIANA` | `BRIGADE` | `DLF` | `GODREJPROP` | `IBREALEST` | `KOLTEPATIL` | `LODHA` | `MAHLIFE` | `NBCC` | `OBEROIRLTY` | `PHOENIXLTD` | `PRESTIGE` | `PURVA` | `SOBHA` | `SUNTECK`

### 🧱 CEMENT (12 Stocks)
*Cement manufacturers and building materials producers.*
> `ACC` | `AMBUJACEM` | `BIRLACORPN` | `DALBHARAT` | `GRASIM` | `HEIDELBERG` | `INDIACEM` | `JKCEMENT` | `PRSMJOHNSN` | `RAMCOCEM` | `SHREECEM` | `ULTRACEMCO`

### 🎬 MEDIA (10 Stocks)
*Broadcasting, movie theatres, content production, and digital gaming.*
> `DBCORP` | `HATHWAY` | `NAZARA` | `NETWORK18` | `PFOCUS` | `PVRINOX` | `SAREGAMA` | `SUNTV` | `TIPSINDLTD` | `ZEEL`

### 🔌 CAP GOODS (12 Stocks)
*Industrial equipment, engineering execution, heavy electricals, and infrastructure giants.*
> `ABB` | `BHEL` | `CGPOWER` | `CUMMINSIND` | `INOXWIND` | `KEI` | `LT` | `POWERINDIA` | `PREMIERENE` | `RVNL` | `SIEMENS` | `WAAREEENER`

### ✈️ SERVICES (11 Stocks)
*Telecom carriers, ports, aviation operators, and digital logistics.*
> `ADANIPORTS` | `BHARTIARTL` | `CONCOR` | `DELHIVERY` | `GMRAIRPORT` | `IDEA` | `INDHOTEL` | `INDIGO` | `INDUSTOWER` | `IRCTC` | `NAUKRI`

### 🛡️ DEFENSE (6 Stocks)
*Aerospace, defense shipyards, and military electronics manufacturers.*
> `BDL` | `BEL` | `COCHINSHIP` | `HAL` | `MAZDOCK` | `SOLARINDS`

---

## 🔒 Verification & Compliance
*   **Upstox Alignment:** All stocks in the generated sector files are mapped automatically to their corresponding instruments in the local database cache.
*   **Zero Compile Errors:** Verified with strict TypeScript compilation checking (`npx tsc --noEmit`).
*   **Synchronization Cycle:** Regenerated daily at 9:10 AM IST (or on server start) to capture inclusions/exclusions automatically.
