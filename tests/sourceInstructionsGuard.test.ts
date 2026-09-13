import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
const require = createRequire(import.meta.url);
const { validateSources, validateDocuments, run } = require('../scripts/source-instructions-guard.cjs');
function fixture() {
  return { sources: [{id:'official',publisher:'CFPB',kind:'law',url:'https://www.consumerfinance.gov/rules-policy/regulations/1002/9/'}],
    claims:[{id:'reasons',source:'official',locator:'1002.9(b)(2)',effectiveDate:null,versionStatus:'transaction-version-unresolved',versionNote:'Verify the version for the transaction date',
      verifiedOn:'2026-09-13',applicability:'Creditor adverse-action reasons under this provision',statement:'Specific reasons are required.'}] };
}
describe('source and instruction boundaries', () => {
  it('checks the actual checkout including hidden agent definitions', () => {
    // Floor, not a target: it only proves the guard scanned the real checkout rather than an
    // empty set. Lowered from 350 when the 95 retired stubs were deleted outright (375 -> 280);
    // their register rows survive as `deleted` recovery records. Raise this only alongside a
    // deliberate corpus change — never lower it to make a failing run pass.
    const result = run(); expect(result.count).toBeGreaterThan(250); expect(result.errors).toEqual([]);
  });
  it('rejects internal documents and lookalike hosts as primary sources', () => {
    for (const url of ['knowledge-base/L2_COMPLIANCE_AND_LOGIC.md', 'https://www.consumerfinance.gov.example.org/rule']) {
      const f = fixture(); f.sources[0].url = url;
      expect(validateSources(f, f.claims[0].statement).join(' ')).toMatch(/URL/);
    }
  });
  it('requires locating detail, applicability and a version record', () => {
    for (const field of ['locator','applicability']) {
      const f: any = fixture(); delete f.claims[0][field];
      expect(validateSources(f, f.claims[0].statement).join(' ')).toContain(`missing ${field}`);
    }
  });
  it('requires either a dated provision or an explicitly unresolved transaction version', () => {
    const f: any = fixture(); delete f.claims[0].versionStatus;
    expect(validateSources(f, f.claims[0].statement).join(' ')).toContain('effective version record');
  });
  it('detects a changed proposition even with the same official link', () => {
    expect(validateSources(fixture(), 'All AI calculation is prohibited.').join(' ')).toContain('statement drift');
  });
  it('rejects future verification dates', () => {
    const f = fixture(); f.claims[0].verifiedOn = '2099-01-01';
    expect(validateSources(f, f.claims[0].statement).join(' ')).toContain('verification date');
  });
  it('rejects new unclassified Markdown instructions', () => {
    expect(validateDocuments({documents:[],activeInstructions:[]},['.claude/agents/new-policy.md'],()=> '').join(' ')).toContain('unclassified Markdown');
  });
  it('rejects an active router back into a retired charter', () => {
    const row=(p:string,d:string)=>({path:p,disposition:d,reason:'fixture',originalBlob:'a'.repeat(40),retiredSha256:createHash('sha256').update('<!-- homiquity-doc: retired -->').digest('hex')});
    const docs: Record<string,string>={'AGENTS.md':'Read knowledge-base/routines/CHARTER.md', 'CLAUDE.md':'Read AGENTS.md',
      'docs/fannie-mae/AGENTS.md':'AGENTS.md', 'knowledge-base/routines/CHARTER.md':'<!-- homiquity-doc: retired -->',
      '.ignore':'/knowledge-base/routines/CHARTER.md'};
    const f={documents:[row('AGENTS.md','rewrite'),row('CLAUDE.md','rewrite'),row('docs/fannie-mae/AGENTS.md','rewrite'),
      row('knowledge-base/routines/CHARTER.md','retired')],activeInstructions:['AGENTS.md','CLAUDE.md']};
    expect(validateDocuments(f,f.documents.map(r=>r.path),(p:string)=>docs[p]).join(' ')).toContain('retired/history authority');
  });
});
