"""Independent source audit of the prepared JSON values and their PDF boxes."""
import csv,hashlib,json,re
from pathlib import Path
import pdfplumber
from decimal import Decimal
ROOT=Path(__file__).resolve().parents[1]
INPUT=Path('/Users/islomshamsiev/Downloads')
def norm(s):return re.sub(r'\s+','',s).replace(',','').replace('$','').replace('%','')
results=[]
for mode in ['finance','academic','research']:
 demo=json.loads((ROOT/f'src/server/demos/data/{mode}.json').read_text());src=INPUT/demo['filename']
 assert hashlib.sha256(src.read_bytes()).hexdigest()==demo['sha256']
 checked=missing=0
 if src.suffix=='.pdf':
  with pdfplumber.open(src) as doc:
   for table in demo['tables']:
    for row in table['rows']:
     for column in table['columns']:
      if column['type']!='decimal':continue
      c=row['cells'][column['key']];page=doc.pages[c['page']-1];b=c['box'];eps=.01
      extracted=page.within_bbox((b['x0']-eps,page.height-b['y1']-eps,b['x1']+eps,page.height-b['y0']+eps)).extract_text(x_tolerance=1,y_tolerance=2) or ''
      assert norm(extracted)==norm(c['raw']),(mode,table['key'],c['page'],column['key'],c['raw'],extracted)
      if c['value'] is None:assert c['raw'] in ['n.a.','...','-'];missing+=1
      elif c['raw']=='-':assert c['value']=='0' and row['cells']['percent']['value']=='0.00'
      else:assert Decimal(norm(c['raw']))==Decimal(c['value'])
      checked+=1
 else:
  with src.open(newline='') as f:records=list(csv.DictReader(f))
  table=demo['tables'][0];assert len(records)==len(table['rows'])==344
  for row,record in zip(table['rows'],records):
   for column in table['columns']:
    c=row['cells'][column['key']];assert c['raw']==record[column['key']]
    if c['value'] is None:assert c['raw'] in ['NA',''];missing+=1
    elif column['type']=='decimal':assert Decimal(c['value'])==Decimal(c['raw'])
    else:assert c['value']==c['raw']
    checked+=1
 if mode=='academic':
  labels=[r['cells']['program']['value'] for r in demo['tables'][0]['rows']];assert len(labels)==len(set(labels)),labels
 results.append({'mode':mode,'tables':len(demo['tables']),'checked_cells':checked,'missing_cells':missing,'source_hash_verified':True,'numeric_mismatches':0,'scope':'PDF numeric cells and printed missing markers; every CSV field. Reconstructed category/header labels are reviewed separately.'})
print(json.dumps(results,indent=2))
out=ROOT/'evaluation/results/prepared-demo';out.mkdir(parents=True,exist_ok=True);(out/'source-audit.json').write_text(json.dumps(results,indent=2)+'\n')
