"use client";
import { useEffect, useRef, useState } from "react";
import type { DecisionSnapshot } from "@/lib/db/runs";
import type { WriteOp } from "@/lib/pipeline/submit";
import type { MetadataOptions } from "@/app/api/metadata/route";
import { effectiveMetadata, type MetadataSettings, type MetadataValues } from "@/lib/metadata/settings";
import type { MetadataReport } from "@/lib/metadata/types";
const label = (s:string)=>s.replaceAll("//"," › ");
function Multi({title,values,options,onChange,allowEmpty=true}:{title:string;values:string[];options:{value:string;label:string}[];onChange:(v:string[])=>void;allowEmpty?:boolean}) {
  const [q,setQ]=useState("");
  return <div className="pm-field"><label>{title}<input aria-label={`Search ${title}`} value={q} onChange={e=>setQ(e.target.value)} placeholder="Search available options" /></label><div className="pm-chips">{values.map(v=><button type="button" key={v} disabled={!allowEmpty && values.length===1} onClick={()=>onChange(values.filter(x=>x!==v))} aria-label={`Remove ${v}`}>{label(options.find(o=>o.value===v)?.label??v)} ×</button>)}</div><select aria-label={`Add ${title}`} value="" onChange={e=>{if(e.target.value)onChange([...new Set([...values,e.target.value])]);}}><option value="">Add an option…</option>{options.filter(o=>!values.includes(o.value)&&o.label.toLowerCase().includes(q.toLowerCase())).slice(0,100).map(o=><option value={o.value} key={o.value}>{label(o.label)}</option>)}</select></div>;
}
export default function PipelineMetadata({enabled,runId,snapshot,plan,options,value,onChange,onBusy}:{enabled:boolean;runId:string;snapshot:DecisionSnapshot;plan:WriteOp[];options:MetadataOptions;value:MetadataSettings;onChange:(v:MetadataSettings)=>void;onBusy:(v:boolean)=>void}) {
  const outputs=plan.filter((o):o is Exclude<WriteOp,{kind:"flag"}>=>o.kind!=="flag");
  const [reports,setReports]=useState<Record<string,MetadataReport>>({});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const [attempt,setAttempt]=useState(0);
  const [status,setStatus]=useState(""); const [busy,setBusy]=useState(false);
  const [paths,setPaths]=useState(options.taxonomies); const [browse,setBrowse]=useState("");const [browseError,setBrowseError]=useState("");
  const [children,setChildren]=useState<string[]>([]); const [branchFilter,setBranchFilter]=useState("");
  const current=useRef(snapshot); useEffect(()=>{current.current=snapshot;},[snapshot]);
  const abort=useRef<AbortController|null>(null);
  // Metadata edits do not change the research inputs. Content, survivor and merge decisions do.
  const sourceKey=JSON.stringify(outputs.map(op=>({...op,metadata:undefined})));
  useEffect(()=>{
    const controller=new AbortController();abort.current=controller;let stopped=false;
    const work=async()=>{
      await Promise.resolve(); if(stopped)return;
      if(!enabled){setBusy(false);onBusy(false);setStatus("Research is off. Your chosen metadata remains editable.");return;}
      setReports({});setErrors({});
      setBusy(true);onBusy(true);
      try {
        for(const op of JSON.parse(sourceKey) as Exclude<WriteOp,{kind:"flag"}>[]){
          if(stopped||controller.signal.aborted)break;
          setStatus(`Researching: ${op.title}`);
          try {
            const response=await fetch("/api/pipeline-metadata",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({runId,key:op.candidateKey,snapshot:current.current}),signal:controller.signal});
            if(!response.ok){const d=await response.json();throw new Error(d.error??"Research failed");}
            const reader=response.body?.getReader();if(!reader)throw new Error("No research response");
            const decoder=new TextDecoder();let buffer="",found=false;
            const receive=(line:string)=>{if(!line.trim()||stopped)return;const e=JSON.parse(line);if(e.type==="error")throw new Error(e.message);if(e.type==="progress")setStatus(`${op.title}: ${e.message}`);if(e.type==="result"){found=true;setReports(p=>({...p,[op.candidateKey]:e.report}));setPaths(p=>[...new Set([...p,...e.report.suggestions.filter((s:{option:{kind:string}})=>s.option.kind==="taxonomy").map((s:{option:{value:string}})=>s.option.value)])]);}};
            while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split("\n");buffer=lines.pop()??"";lines.forEach(receive);}receive(buffer+decoder.decode());if(!found&&!stopped)throw new Error("Research ended before completion");
          }catch(e){if(!stopped)setErrors(p=>({...p,[op.candidateKey]:e instanceof Error?e.message:"Research failed"}));}
        }
      }finally{if(!stopped){setBusy(false);onBusy(false);setStatus(controller.signal.aborted ? "Research stopped. Completed suggestions remain available; choose metadata manually for unfinished articles." : "Metadata research finished. Review and choose which suggestions to use.");}}
    };
    void work();return()=>{stopped=true;controller.abort();onBusy(false);};
  },[enabled,runId,sourceKey,onBusy,attempt]);
  async function browsePath(path:string){setBrowseError("");try{const r=await fetch(`/api/pipeline-metadata?path=${encodeURIComponent(path)}`);const d=await r.json();if(!r.ok)throw new Error(d.error);setBrowse(path);setBranchFilter("");setChildren(d.paths.map((p:{value:string})=>p.value));setPaths(p=>[...new Set([...p,...d.paths.map((x:{value:string})=>x.value)])]);}catch(e){setBrowseError(e instanceof Error?e.message:"Could not browse taxonomies");}}
  const collections=options.collections.map(c=>({value:c.code,label:c.label}));
  const fallback=options.collections.find(c=>c.code===snapshot.collection||c.label===snapshot.collection)?.code??snapshot.collection;
  function fields(settings:MetadataValues,change:(v:MetadataValues)=>void,id:string,canClearTaxonomy=true){return <div className="pm-fields"><Multi title={`${id} collections`} values={settings.collections??[fallback].filter(Boolean)} options={collections} allowEmpty={false} onChange={v=>change({collections:v})}/><Multi title={`${id} taxonomies`} allowEmpty={canClearTaxonomy} values={settings.taxonomies??[]} options={paths.map(p=>({value:p,label:p}))} onChange={v=>change({taxonomies:v})}/><label>Language<select aria-label={`${id} language`} value={settings.language??snapshot.language} onChange={e=>change({language:e.target.value})}>{options.languages.map(l=><option key={l}>{l}</option>)}</select></label></div>;}
  function suggestions(report:MetadataReport):MetadataValues {const c=report.suggestions.filter(s=>s.option.kind==="collection").map(s=>s.option.value),t=report.suggestions.filter(s=>s.option.kind==="taxonomy").map(s=>s.option.value);return {...(c.length?{collections:c}:{}),...(t.length?{taxonomies:t}:{})};}
  return <div className="pm-panel"><h3>Discover and suggest metadata</h3><p>Research runs for each resulting article. Choose suggestions below or adjust global defaults and individual articles.</p><div role="status">{status}</div>{!busy && Object.keys(errors).length>0 && <button type="button" className="ds-btn ds-btn-secondary" onClick={()=>setAttempt(n=>n+1)}>Retry failed research</button>}{busy&&<button type="button" className="ds-btn ds-btn-secondary" onClick={()=>abort.current?.abort()}>Stop research</button>}
    <details open><summary>Global defaults</summary><p>Explicit choices here apply to all articles without a per-solution override. Existing articles otherwise retain their metadata.</p>{fields(value.global??{},global=>onChange({...value,global:{...value.global,...global}}),"Global")}</details>
    <details><summary>Browse more taxonomies</summary><button type="button" onClick={()=>void browsePath("")}>Root</button>{browse&&<button type="button" onClick={()=>void browsePath(browse.split("//").slice(0,-1).join("//"))}>Parent</button>}<p>{label(browse)}</p><input aria-label="Filter taxonomy branches" placeholder="Filter branches" value={branchFilter} onChange={e=>setBranchFilter(e.target.value)}/><p>Showing up to 100 matching paths.</p>{children.filter(p=>p.toLowerCase().includes(branchFilter.toLowerCase())).slice(0,100).map(p=><button type="button" className="pm-browse" key={p} onClick={()=>void browsePath(p)}>{label(p)} →</button>)}{browseError&&<p role="alert">{browseError}</p>}</details>
    {outputs.map(op=>{const r=reports[op.candidateKey];const override=value.solutions?.[op.candidateKey];const settings=effectiveMetadata(value,op.candidateKey)??{};const shown={...(op.kind==="revise"&&r?{collections:r.solution.collections,taxonomies:r.solution.taxonomy,language:r.solution.language}:{}),...settings};return <details key={op.candidateKey} open className="pm-article"><summary>{op.title}</summary><p>{override?"Uses per-solution settings":"Inherits global choices; existing values are preserved when no global choice is set."}</p>{errors[op.candidateKey]&&<p role="alert">Research unavailable: {errors[op.candidateKey]}. You can still choose metadata manually.</p>}{r&&<><p>{r.rationale}</p>{r.suggestions.filter(s=>s.option.kind!=="attribute").map(s=><div className="pm-reason" key={s.option.id}><strong>{label(s.option.label)}</strong><p>{s.reason}</p><small>Evidence: {s.sourceEvidence}</small></div>)}{!!r.uncertainties.length&&<p>{r.uncertainties.join(" ")}</p>}<div className="pm-actions"><button type="button" className="ds-btn ds-btn-secondary" onClick={()=>onChange({...value,solutions:{...value.solutions,[op.candidateKey]:{...override,...suggestions(r)}}})}>Use suggestions for this solution</button><button type="button" className="ds-btn ds-btn-secondary" onClick={()=>onChange({...value,global:{...value.global,...suggestions(r)}})}>Use these as global defaults</button></div><details><summary>Research evidence and coverage</summary><p>{r.coverage.examples} examples; {r.coverage.taxonomyPaths} discovered paths.</p>{r.examples.map(e=><p key={e.id}>{e.title} ({e.id}) — {e.taxonomy.map(label).join("; ")}</p>)}<p>{r.limitations.join(" ")}</p></details></>}{fields(shown,v=>onChange({...value,solutions:{...value.solutions,[op.candidateKey]:{...override,...v}}}),op.title,op.kind!=="revise"||r?.solution.taxonomy?.length===0)}{override&&<button type="button" onClick={()=>{const solutions={...value.solutions};delete solutions[op.candidateKey];onChange({...value,solutions});}}>Reset to global / existing values</button>}</details>;})}
  </div>;
}
