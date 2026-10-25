"""Build hash-bound prepared demos from the three user-supplied sources.
Run with pdfplumber installed. This is offline preparation, never live AI extraction.
"""
import csv, hashlib, json, re, statistics
from pathlib import Path
import pdfplumber
from decimal import Decimal
ROOT=Path(__file__).resolve().parents[1]
INPUT=Path('/Users/islomshamsiev/Downloads')
OUT=ROOT/'src/server/demos/data'
NUM=re.compile(r'^(?:[-+]?\$?[\d,]+(?:\.\d+)?%?|n\.a\.|\.\.\.|-)$')
def lines(page):
 groups=[]
 for w in sorted(page.extract_words(x_tolerance=1,y_tolerance=2),key=lambda w:(round(w['top']/2)*2,w['x0'])):
  match=next((g for g in groups[-4:] if abs(g[0]['top']-w['top'])<2),None)
  if match is None: groups.append([w])
  else: match.append(w)
 return [sorted(g,key=lambda w:w['x0']) for g in groups]
def box(words,p):
 return {'x0':min(w['x0'] for w in words),'y0':p.height-max(w['bottom'] for w in words),'x1':max(w['x1'] for w in words),'y1':p.height-min(w['top'] for w in words)}
def cell(raw,words,page,p,value=None):
 if value is None and raw not in ('n.a.','...','-','NA'):
  value=raw.replace(',','').replace('$','').replace('%','').strip()
 return {'raw':raw,'value':value,'page':page,'box':box(words,p)}
def col(key,label,typ='decimal',unit=None,currency=None,role='y',percent=False):
 return {'key':key,'label':label,'type':typ,'unit':unit,'currency':currency,'role':role,'percent':percent}
def table(key,title,page,columns,rows,note):
 return {'key':key,'title':title,'page':page,'columns':columns,'rows':rows,'note':note}
def numeric_lines(p,n):
 out=[]
 for ws in lines(p):
  if len(ws)>n and all(NUM.fullmatch(w['text']) for w in ws[-n:]):out.append((ws[:-n],ws[-n:]))
 return out

def finance():
 filename='g19.pdf'; tables=[]
 periods=['2021','2022','2023','2024','2025','2025 Q2','2025 Q3','2025 Q4','2026 Q1','2026 Q2','2026 Jun','2026 Jul','2026 Aug']
 with pdfplumber.open(INPUT/filename) as d:
  p=d.pages[0]; data=numeric_lines(p,13)
  assert len(data)==17,[(" ".join(w['text'] for w in a),len(b)) for a,b in data]
  common='Original release: August 2026, released October 7, 2026. Annual, quarterly and monthly periods are separate source observations; do not add them together. Q2/Jun/Jul 2026 revised; August preliminary. All original printed numbers and missing markers retained.'
  defs=[('growth','Consumer credit growth — seasonally adjusted annual rates',0,3,'percent annual rate',True),('flows-sa','Consumer credit flows — seasonally adjusted annual rates',3,6,'USD billions annual rate',False),('balances-sa','Consumer credit balances — seasonally adjusted',6,9,'USD billions',False),('bank-apr','Commercial-bank loan and credit-card APRs',9,14,'percent APR',True),('auto-finance','Finance-company new-car terms',14,17,None,False)]
  for key,title,start,end,unit,pct in defs:
   selected=data[start:end];cols=[col('period','Reporting period','text',role='category')]
   for j,(label,vals) in enumerate(selected):
    labeltext=' '.join(w['text'] for w in label)
    if key=='bank-apr':labeltext=['New-car loan, 60-month','New-car loan, 72-month','Credit card, all accounts','Credit card, assessed interest','Personal loan, 24-month'][j]
    cu=unit if key!='auto-finance' else ['percent APR','months','USD'][j]
    cols.append(col('v'+str(j),labeltext,unit=cu,currency='USD' if cu and cu.startswith('USD') else None,percent=pct or (key=='auto-finance' and j==0)))
   rows=[]
   for i,period in enumerate(periods):
    # Period labels are reconstructed from the printed multilevel header, with header-box evidence.
    first_top=data[0][1][0]['top']; header=[w for ws in lines(p) for w in ws if first_top-55<w['top']<first_top-2]
    cells={'period':cell(period.split()[-1],header or selected[0][0],1,p,period)}
    for j,(_,vals) in enumerate(selected):cells['v'+str(j)]=cell(vals[i]['text'],[vals[i]],1,p)
    rows.append({'cells':cells})
   note=common+' '+('Seasonally adjusted. Growth and flow series are annualized rates, not month-over-month percentages or monthly dollar changes.' if key in ('growth','flows-sa') else 'Commercial-bank APRs and finance-company terms are not seasonally adjusted.' if key in ('bank-apr','auto-finance') else 'End-of-period outstanding balances; not credit flows.')
   tables.append(table(key,title,1,cols,rows,note))
  for pn,key,title in [(2,'balances-nsa','Consumer credit by holder — not seasonally adjusted'),(3,'flows-nsa','Consumer credit flows by holder — not seasonally adjusted')]:
   p=d.pages[pn-1]; data=numeric_lines(p,13); cols=[col('period','Reporting period','text',role='category')]; names=[]; seen={}
   # Page 2 and 3 rows occur in explicit blocks: total, holder totals, revolving, holders, nonrevolving, holders, memo.
   for j,(label,vals) in enumerate(data):
    name=' '.join(w['text'] for w in label)
    if 7<=j<=11:name='Revolving · '+name
    elif 13<=j<=17:name='Nonrevolving · '+name
    seen[name]=seen.get(name,0)+1
    names.append(name)
    cols.append(col('v'+str(j),name,unit='USD billions' + (' annual rate' if pn==3 else ''),currency='USD'))
   rows=[]
   for i,period in enumerate(periods):
    first_top=data[0][1][0]['top']; header=[w for ws in lines(p) for w in ws if first_top-55<w['top']<first_top-2]; cells={'period':cell(period.split()[-1],header,pn,p,period)}
    for j,(_,vals) in enumerate(data):cells['v'+str(j)]=cell(vals[i]['text'],[vals[i]],pn,p)
    rows.append({'cells':cells})
   assert len(data)==20, (pn,len(data),names)
   tables.append(table(key,title,pn,cols,rows,common+' Not seasonally adjusted; do not directly compare with seasonally adjusted levels/flows. Federal government figures principally reflect education loans. Memo student/motor-vehicle loans are separate overlapping categories, not components to sum with the holder totals.'))
 facts=[]
 def insight(title,text,key,rows,cols):facts.append({'title':title,'text':text,'datasetKey':key,'rows':rows,'columns':cols})
 insight('August credit growth slowed','The reported seasonally adjusted annual growth rate was 1.9% in August, down from 4.1% in July: a 2.2 percentage-point decline. These are annualized growth rates, not actual monthly percentage changes.','growth',[11,12],['v0'])
 insight('Revolving and nonrevolving credit diverged','August revolving credit contracted at an annual rate of 4.2%, while nonrevolving credit expanded at 4.1%. July figures were +2.5% and +4.7%, respectively. The series should not be averaged without weights.','growth',[11,12],['v1','v2'])
 delta=Decimal('5196.8')-Decimal('5188.5')
 insight('Outstanding balances rose despite slower growth',f'Seasonally adjusted total balances rose from $5,188.5 billion in July to $5,196.8 billion in August: +${delta} billion, computed from rounded published levels. Revolving balances fell $4.8 billion while nonrevolving balances rose $13.1 billion. These rounded-level changes need not reproduce the published break-adjusted flow series.','balances-sa',[11,12],['v0','v1','v2'])
 insight('Annualized flows are not monthly borrowing','The August seasonally adjusted total flow is $99.4 billion at an annual rate, versus $212.9 billion for July. The revolving contribution is −$57.4 billion and nonrevolving +$156.8 billion, both annualized. Do not describe $99.4 billion as borrowing during August.','flows-sa',[11,12],['v0','v1','v2'])
 insight('Credit-card APRs remain distinct from loan rates','August commercial-bank APRs: 21.19% across all credit-card accounts and 22.36% for accounts assessed interest; 7.54% for 60-month new-car loans, 7.17% for 72-month loans, and 11.90% for 24-month personal loans. June/July entries are n.a.; no interpolation is used. These are aggregate reported rates, not a personalized lending offer.','bank-apr',[10,11,12],['v0','v1','v2','v3','v4'])
 insight('The release contains different adjustment bases','August total outstanding is $5,196.8 billion seasonally adjusted on page 1, versus $5,162.9 billion not seasonally adjusted on page 2. Their difference is not an extraction error. Separate datasets preserve the adjustment basis.','balances-nsa',[12],['v0'])
 insight('Interpret the publication notes','The source marks August as preliminary and several earlier 2026 observations revised. Credit excludes loans secured by real estate; growth rates adjust for series breaks and use unrounded data. Finance-company July/August terms and memo loan categories are unavailable in places. All 3 pages of quantitative tables are represented, while footnotes are summarized here.','auto-finance',[10,11,12],['v0','v1','v2'])
 return {'mode':'finance','filename':filename,'title':'Federal Reserve consumer credit — August 2026','scope':'Seven prepared tables covering the quantitative tables on all three pages. Period frequency, seasonal adjustment, annualization, missingness and revision status remain explicit. Descriptive analysis of the supplied release, not a current-market update or personal financial advice.','tables':tables,'insights':facts,'limitations':['Prepared offline from the embedded PDF text, then checked against the rendered source. This is not a live Gemini run.','Values remain at the printed precision. Derived differences use those rounded published values.','No forecasts, credit recommendations, or causal claims are inferred.']}

def academic():
 fn='FI-Supporting-Materials-07-17-25.pdf';tables=[]
 with pdfplumber.open(INPUT/fn) as d:
  p=d.pages[53]; tuples=numeric_lines(p,9); rows=[];residency='Pennsylvania resident'; idx=0
  # Match order across both residency sections; keep all full-year/semester/per-credit rows with 9 printed values.
  for label,nums in tuples:
   name=' '.join(w['text'] for w in label)
   if idx==9:residency='Non-Pennsylvania resident'
   cells={'program':cell(residency+' · '+name,label,54,p,residency+' · '+name)}
   for k,w in zip(['annual25','annualInc','annual26','semester25','semesterInc','semester26','credit25','creditInc','credit26'],nums):cells[k]=cell(w['text'],[w],54,p)
   rows.append({'cells':cells});idx+=1
  # Identify sections using actual y-coordinates rather than assuming an equal row count.
  boundary=next(ws[0]['top'] for ws in lines(p) if ' '.join(w['text'] for w in ws)=='Non-Pennsylvania Residents')
  graduate_tops=[ws[0]['top'] for ws in lines(p) if re.fullmatch(r'Graduate\s*:', ' '.join(w['text'] for w in ws))]
  for row,(label,_) in zip(rows,tuples):
   nonresident=label[0]['top']>boundary
   graduate=label[0]['top']>graduate_tops[1] if nonresident else label[0]['top']>graduate_tops[0]
   prefix=('Non-PA' if nonresident else 'PA')+(' graduate' if graduate else ' undergraduate')
   row['cells']['program']['value']=' '.join(w['text'] for w in label)+' · '+prefix
  columns=[col('program','Residency and program','text',role='category')]+[col(k,label,unit=unit,currency='USD') for k,label,unit in [('annual25','2025–26 annual tuition','USD per academic year'),('annualInc','Proposed annual increase','USD per academic year'),('annual26','Projected 2026–27 annual tuition','USD per academic year'),('semester25','2025–26 semester tuition','USD per semester'),('semesterInc','Proposed semester increase','USD per semester'),('semester26','Projected 2026–27 semester tuition','USD per semester'),('credit25','2025–26 per-credit tuition','USD per credit'),('creditInc','Proposed per-credit increase','USD per credit'),('credit26','Projected 2026–27 per-credit tuition','USD per credit')]]
  assert len(rows)==18,len(rows)
  tables.append(table('tuition','University Park tuition — projected 2026–27',54,columns,rows,'Selected full annual/semester/per-credit rows from Schedule 1. Rows without a full nine-value schedule (including some graduate programs) are not represented. Resident and nonresident categories are separate. Upper division applies from 59.1 credits; consult page 62. Figures are proposed/projected, not proof of final approved or current billed tuition.'))
  # Use geometrical column grouping to preserve digits spaced within a PDF cell (e.g. "8 3" means printed 83).
  for pn,key,title in [(66,'housing-up','University Park housing — proposed 2026–27'),(67,'housing-cwc','Commonwealth housing — proposed 2026–27')]:
   p=d.pages[pn-1];rows=[]
   # x centers obtained from the actual column layout, validated by header and value checks below.
   for ws in lines(p):
    if not ws[-1]['text'].endswith('%') or not re.fullmatch(r'\d+\.\d+%',ws[-1]['text']):continue
    chunks=[[],[],[],[],[],[]]
    # PDF widths 612; each numeric column has a stable positional band.
    for w in ws:
     mid=(w['x0']+w['x1'])/2
     band=0 if mid<260 else 1 if mid<310 else 2 if mid<375 else 3 if mid<430 else 4 if mid<490 else 5
     chunks[band].append(w)
    if not all(chunks):raise ValueError((pn,[[w['text'] for w in c] for c in chunks]))
    cells={}
    for k,ch in zip(['room','occupants','rate25','increase','rate26','percent'],chunks):
     raw=' '.join(w['text'] for w in ch);value=raw if k=='room' else ''.join(w['text'] for w in ch).replace(',','').replace('%','')
     # A dash in the increase column means explicitly no increase on rows showing 0.00%.
     if value=='-' and k=='increase':value='0'
     cells[k]=cell(raw,ch,pn,p,value)
    rows.append({'cells':cells})
   assert len(rows)==(31 if pn==66 else 27),(pn,len(rows))
   tables.append(table(key,title,pn,[col('room','Housing description','text',role='category'),col('occupants','Occupants',unit='people'),col('rate25','Approved 2025–26 rate',unit='USD per person per semester',currency='USD'),col('increase','Printed proposed increase',unit='USD per person per semester',currency='USD'),col('rate26','Proposed 2026–27 rate',unit='USD per person per semester',currency='USD'),col('percent','Proposed rate increase',unit='percent',percent=True)],rows,'Schedule I; rates per person per semester. All rows on this page are retained. Printed increases and printed totals may differ by a dollar because of source rounding; neither is overwritten. Room type and occupancy matter; proposals are not final bills.'))
  p=d.pages[62];rows=[]
  for label,nums in numeric_lines(p,3):
   if not all(re.fullmatch(r'\$?[\d,]+\.\d{2}',w['text']) for w in nums):continue
   cells={'campus':cell(' '.join(w['text'] for w in label),label,63,p,' '.join(w['text'] for w in label))}
   for k,w in zip(['full','part','low'],nums):cells[k]=cell(w['text'],[w],63,p)
   rows.append({'cells':cells})
  assert len(rows)==24,len(rows)
  tables.append(table('fees','Student-initiated fees — fall/spring 2026–27',63,[col('campus','Campus/program','text',role='category'),col('full','9 or more credits',unit='USD per semester',currency='USD'),col('part','5 to fewer than 9 credits',unit='USD per semester',currency='USD'),col('low','Fewer than 5 credits',unit='USD per semester',currency='USD')],rows,'Schedule 2, per semester. Hershey medical $72 per academic year is intentionally excluded from this semester-based table. These are student-initiated fees, not tuition or total attendance costs.'))
  p=d.pages[68];rows=[]
  for label,nums in numeric_lines(p,3):
   text=' '.join(w['text'] for w in label)
   if not nums[-1]['text'].endswith('%') or not re.search(r'20\d\d[/–-]\d\d',text):continue
   cells={'period':cell(text,label,69,p,text)}
   for k,w in zip(['rate','increase','percent'],nums):cells[k]=cell(w['text'],[w],69,p)
   rows.append({'cells':cells})
  assert len(rows)==18,len(rows)
  tables.append(table('room-food-history','Double room and mid-level meal-plan rate history',69,[col('period','Campus group and academic year','text',role='category'),col('rate','Semester package rate',unit='USD per semester',currency='USD'),col('increase','Semester increase',unit='USD per semester',currency='USD'),col('percent','Rate increase',unit='percent',percent=True)],rows,'Page 69 historical comparison. 2026–27 entries are proposed. UP, CWC1, CWC2 are separately identified in the source; earlier rows without a campus label retain that lack of specificity. The upper/lower meal-plan tables have no explicit plan names on this page and are not assigned invented names.'))
 facts=[]
 def ins(title,text,key,rows,cols):facts.append({'title':title,'text':text,'datasetKey':key,'rows':rows,'columns':cols})
 ins('The packet contains proposals, not a current bill','The July 2025 packet labels the tuition schedule projected and the 2026–27 housing/food rates proposed. Use this demo to inspect the proposal, not to claim these are today’s approved charges. The curated datasets cover pages 54, 63, 66, 67 and 69, not all 70 pages.','tuition',[0],['program','annual25','annual26'])
 ins('Resident and nonresident tuition changes differ','University Park lower-division annual tuition is $20,468 → $20,878 for Pennsylvania residents (+$410, approximately 2.00%) and $42,860 → $44,574 for nonresidents (+$1,714, approximately 4.00%). Percentages here are computed from the printed annual tuition. Annual, semester, and per-credit rates are distinct billing bases.','tuition',[0,9],['program','annual25','annualInc','annual26'])
 ins('Standard double-room proposal','Double Traditional housing lists $4,039 approved for 2025–26 and $4,150 proposed for 2026–27, per person per semester. The printed increase is $111 and the printed percentage 2.75%. This covers housing alone, not food or tuition.','housing-up',[0],['room','rate25','increase','rate26','percent'])
 ins('Compare room types without changing occupancy basis','The housing table separates room types and occupant counts. The University Park dataset includes both residence halls and undergraduate apartments. Rates are per person per semester; do not multiply by occupants unless explicitly constructing a total-room comparison.','housing-up',[0,11,25],['room','occupants','rate25','rate26'])
 ins('Campus groups do not share one increase','Commonwealth Campus group 1 rows generally show 1.75% proposed increases; group 2 rows list 0.00%, preserving their unchanged approved/proposed rates. The two RA rows are separately listed at 2.75%.','housing-cwc',[0,2,22],['room','rate25','rate26','percent'])
 ins('Student fees depend on credit load','University Park student-initiated fees are listed as $320 per semester for 9+ credits, $240 for 5–<9 credits, and $160 for <5 credits. This fee is separate from tuition, housing and food. Annual medical-program fees are not mixed into this semester comparison.','fees',[18],['campus','full','part','low'])
 ins('A housing-and-food comparison with explicit scope','For UP, the source’s standard double-room/mid-level meal package is $6,940 per semester in 2025–26 versus $7,138 proposed for 2026–27 (+$198, printed 2.85%). Two identical semesters would imply $14,276 for the proposed package; that is a calculated scenario, not a quoted annual attendance cost and excludes tuition and other expenses.','room-food-history',[0,3],['period','rate','increase','percent'])
 return {'mode':'academic','filename':fn,'title':'Penn State tuition and student-living proposals','scope':'Prepared student-life subset: University Park tuition (page 54), student fees (63), housing schedules (66–67), and room/food rate history (69). The rest of the 70-page finance packet is not extracted in this demo.','tables':tables,'insights':facts,'limitations':['The document is a July 2025 proposal packet; proposed 2026–27 rates are not asserted to be approved or currently payable.','Different annual/semester/per-credit/per-person rates are not combined into an invented total cost.','Prepared offline from PDF text with page/box evidence. Live AI analysis is still a separate optional action.']}

def research():
 fn='penguins.csv'
 with open(INPUT/fn,newline='') as f:records=list(csv.DictReader(f))
 fields=list(records[0]);numeric={'bill_length_mm':'mm','bill_depth_mm':'mm','flipper_length_mm':'mm','body_mass_g':'g','year':'year'}
 columns=[col(k,k,'decimal' if k in numeric else 'text',numeric.get(k),role='x' if k=='bill_length_mm' else 'y' if k in numeric and k!='year' else 'category' if k=='species' else 'other') for k in fields]
 rows=[{'cells':{k:{'raw':r[k],'value':None if r[k] in ('','NA') else r[k],'line':i+2,'field':j} for j,k in enumerate(fields)}} for i,r in enumerate(records)]
 assert len(records)==344
 facts=[]
 def ins(title,text,indices,cols):facts.append({'title':title,'text':text,'datasetKey':'penguins','rows':indices,'columns':cols})
 counts={s:sum(r['species']==s for r in records) for s in sorted({r['species'] for r in records})}
 missing={k:sum(r[k] in ('','NA') for r in records) for k in fields}
 ins('Three species, three islands, 344 records','The supplied CSV contains 344 penguin records: '+', '.join(f'{s}: {n}' for s,n in counts.items())+'. Islands are '+', '.join(sorted({r['island'] for r in records}))+'. Recorded years are '+', '.join(sorted({r['year'] for r in records}))+'. These are sample counts, not species population estimates.',list(range(344)),['species','island','year'])
 ins('Missing values stay missing','NA is interpreted as missing in this prepared dataset. Missing counts: '+', '.join(f'{k}: {v}' for k,v in missing.items() if v)+'. No imputation or zero substitution is performed. Numeric measurements are stored as exact decimal strings with declared numeric types; sex remains categorical.',[i for i,r in enumerate(records) if any(v=='NA' for v in r.values())],fields)
 for species in counts:
  inds=[i for i,r in enumerate(records) if r['species']==species];measures={k:[Decimal(records[i][k]) for i in inds if records[i][k]!='NA'] for k in ['bill_length_mm','bill_depth_mm','flipper_length_mm','body_mass_g']}
  text='; '.join(f'{k}: mean {sum(v)/len(v):.2f} {numeric[k]} (n={len(v)})' for k,v in measures.items())
  ins(species+' measurement summary',text+'. Means are calculated from nonmissing values in this CSV. They describe this sample and do not establish a causal species effect.',inds,['species',*measures])
 pairs=[(float(r['flipper_length_mm']),float(r['body_mass_g'])) for r in records if r['flipper_length_mm']!='NA' and r['body_mass_g']!='NA']
 corr=statistics.correlation([x for x,y in pairs],[y for x,y in pairs])
 ins('Flipper length and body mass co-vary in this sample',f'Pearson r = {corr:.4f} across {len(pairs)} pairwise-complete observations. This pooled descriptive relationship can reflect species and sex composition; it does not establish causation. Inspect the two measurement columns and compare species-specific views before generalizing.',list(range(344)),['species','flipper_length_mm','body_mass_g'])
 return {'mode':'research','filename':fn,'title':'Penguin morphology — source-linked research demo','scope':'All 344 records and all 8 columns of the supplied penguins.csv; NA/empty fields explicitly marked missing. No records dropped and no missing measurements invented.','tables':[table('penguins','Penguin morphology measurements',1,columns,rows,'Full supplied CSV. Measurements retain mm and g; year remains an identifier/time label rather than a measured outcome. NA denotes missing in this prepared file. Species, island and sex remain categories.')],'insights':facts,'limitations':['Prepared descriptive statistics are computed from this exact uploaded file, not generated live by an AI model.','Sample composition and missingness matter. Correlations are observational, not causal.','The CSV contains no citation or collection-method metadata; do not infer a study design from the filename.']}

if __name__=='__main__':
 OUT.mkdir(parents=True,exist_ok=True)
 for build in [finance,academic,research]:
  demo=build();demo['sha256']=hashlib.sha256((INPUT/demo['filename']).read_bytes()).hexdigest();demo['preparation']='Offline text/CSV extraction; source-bound prepared demo v1'
  (OUT/(demo['mode']+'.json')).write_text(json.dumps(demo,ensure_ascii=False,indent=2))
  print(demo['mode'],[(t['key'],len(t['rows']),len(t['columns'])) for t in demo['tables']])
