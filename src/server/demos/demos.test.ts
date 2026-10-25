import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { DecimalStringSchema, newId, type Source, type SourceSelection } from '@/contracts';
import { DEMOS, buildDemoDraft, getPreparedDemo, prepareDemo } from './index';
import { validateDraft } from '@/server/orchestration/extraction';
import { getRepositories, newBlobKey } from '@/server/storage';
import { makeOwner } from '../../../tests/helpers/owners';

function source(mode: keyof typeof DEMOS): Source {
  const file=DEMOS[mode];
  return { id:newId('src'),filename:file.filename,sha256:file.sha256,byteSize:1,createdAt:new Date().toISOString(),kind:mode==='research'?'csv':'pdf',mimeType:mode==='research'?'text/csv':'application/pdf',pageCount:mode==='finance'?3:mode==='academic'?70:null,sheetNames:null,image:null,processingDisclosure:'local_parser',capabilities:{preview:true,crop:mode!=='research',selectSheet:false,textCoordinates:mode!=='research'} };
}
function selection(src: Source): SourceSelection { return {id:newId('sel'),sourceId:src.id,createdAt:new Date().toISOString(),kind:'csv_records',delimiter:',',headerRecordCount:1,selectedColumnIndexes:null,recordInterval:null}; }

describe('prepared real-source manifests',()=>{
  for (const mode of ['finance','academic','research'] as const) {
    for (const table of DEMOS[mode].tables) it(`${mode}/${table.key}: valid numeric cells, evidence and honest coverage`,()=>{
      const src=source(mode);const draft=buildDemoDraft(src,selection(src),DEMOS[mode],table);
      expect(()=>validateDraft(draft,true)).not.toThrow();
      expect(draft.extraction).toBeNull();
      expect(draft.coverage).toBe(mode==='research'?'complete_selection':'partial_selection');
      table.columns.forEach((column,ci)=>{
        const id=draft.columns[ci].id;
        expect(draft.columns[ci].dataType).toBe(column.type);
        draft.rows.forEach((row,ri)=>{
          const cell=row.cells[id];const original=table.rows[ri].cells[column.key];
          expect(cell.rawText).toBe(original.raw);
          expect(cell.currentValue).toBe(original.value);
          if(column.type==='decimal' && cell.currentValue!==null) expect(DecimalStringSchema.safeParse(cell.currentValue).success).toBe(true);
          expect(cell.provenanceIds).toHaveLength(1);
        });
      });
    });
  }
  it('preserves all penguin records and real missing counts',()=>{
    const table=DEMOS.research.tables[0];
    expect(table.rows).toHaveLength(344);
    for(const key of ['bill_length_mm','bill_depth_mm','flipper_length_mm','body_mass_g']) expect(table.rows.filter(r=>r.cells[key].value===null)).toHaveLength(2);
    expect(table.rows.filter(r=>r.cells.sex.value===null)).toHaveLength(11);
  });
  it('links each prepared claim to existing table rows and columns',()=>{
    for(const demo of Object.values(DEMOS))for(const claim of demo.insights){
      const table=demo.tables.find(t=>t.key===claim.datasetKey)!;
      expect(table).toBeDefined();expect(claim.rows.length).toBeGreaterThan(0);
      expect(claim.rows.every(i=>i>=0&&i<table.rows.length)).toBe(true);
      expect(claim.columns.every(k=>table.columns.some(c=>c.key===k))).toBe(true);
    }
  });
  it('rejects a lookalike filename and rejects a mismatched stored blob before preparing anything',async()=>{
    const owner=makeOwner('demo-rejection');const repos=getRepositories();const src=source('research');
    const bytes=new TextEncoder().encode('test-only invalid source');const blobKey=newBlobKey(owner.ownerId,src.id);
    await repos.blobs.put(blobKey,bytes);await repos.sources.create(owner,{source:src,blobKey});
    expect(createHash('sha256').update(bytes).digest('hex')).not.toBe(src.sha256);
    await expect(prepareDemo(owner,src.id,'research')).rejects.toMatchObject({code:'bad_request'});
    await expect(getPreparedDemo(makeOwner('other'),src.id)).rejects.toMatchObject({code:'not_found'});
    expect(await repos.datasets.listBySource(owner,src.id)).toHaveLength(0);
  });
});
