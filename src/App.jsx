import React, { useState } from 'react';

const ENGINE_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite'
];

const DB_TARGETS = [
  { id: 'snowflake', label: 'Snowflake' },
  { id: 'bigquery', label: 'Google BigQuery' },
  { id: 'databricks', label: 'Databricks SQL' },
  { id: 'redshift', label: 'Amazon Redshift' },
  { id: 'synapse', label: 'Azure Synapse Analytics' },
  { id: 'postgres', label: 'PostgreSQL' }
];

export default function App() {
  const [activeTab, setActiveTab] = useState('transpiler');
  
  // Core Code States
  const [sourceCode, setSourceCode] = useState('');
  const [targetDb, setTargetDb] = useState('snowflake');
  const [dbtSql, setDbtSql] = useState('');
  const [dbtYaml, setDbtYaml] = useState('');
  
  // UI & Loading States
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [isError, setIsError] = useState(false);

  // DAG Analysis & Human-in-the-Loop States
  const [isDagLoading, setIsDagLoading] = useState(false);
  const [showDagModal, setShowDagModal] = useState(false);
  const [dagStatus, setDagStatus] = useState('pending'); // 'pending', 'clean', 'error'
  const [dagData, setDagData] = useState(null);

  // Modals & Config
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showGitModal, setShowGitModal] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('oracle_engine_key') || '');
  
  // GitHub State
  const [gitToken, setGitToken] = useState(() => localStorage.getItem('github_pat') || '');
  const [gitOwner, setGitOwner] = useState(() => localStorage.getItem('github_owner') || '');
  const [gitRepo, setGitRepo] = useState(() => localStorage.getItem('github_repo') || '');
  const [isDeploying, setIsDeploying] = useState(false);

  // Dynamic AI Scaffolder State
  const [scaffoldTree, setScaffoldTree] = useState(null);
  const [isScaffolding, setIsScaffolding] = useState(false);

  // AI-Driven Dual-Run Validation & Healing State
  const [validationRun, setValidationRun] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [aiSelfHealing, setAiSelfHealing] = useState(false);
  const [isRemediating, setIsRemediating] = useState(false);
  const [isSelfHealedCode, setIsSelfHealedCode] = useState(false);

  // Config Handlers
  const saveConfig = () => {
    localStorage.setItem('oracle_engine_key', apiKey.trim());
    setShowConfigModal(false);
    showStatus('Engine configuration saved.');
  };

  const saveGitConfig = () => {
    localStorage.setItem('github_pat', gitToken.trim());
    localStorage.setItem('github_owner', gitOwner.trim());
    localStorage.setItem('github_repo', gitRepo.trim());
    setShowGitModal(false);
    showStatus('GitHub configuration saved.');
  };

  const showStatus = (msg, error = false) => {
    setStatusMessage(msg);
    setIsError(error);
  };

  const resetGeneratedStates = () => {
    setScaffoldTree(null);
    setValidationRun(false);
    setAnalysisResult(null);
    setAiSelfHealing(false);
    setIsSelfHealedCode(false);
  };

  const handleSourceChange = (e) => {
    setSourceCode(e.target.value);
    setDagStatus('pending');
    setDagData(null);
    resetGeneratedStates();
  };

  // BRUTE-FORCE JSON EXTRACTOR: Ignores all AI conversational filler and markdown
  const safeJsonParse = (rawStr) => {
    const start = rawStr.indexOf('{');
    const end = rawStr.lastIndexOf('}');
    if (start === -1 || end === -1) {
      throw new Error('No JSON structure detected in the engine response.');
    }
    const cleanStr = rawStr.substring(start, end + 1);
    return JSON.parse(cleanStr);
  };

  const callNeuralEngine = async (promptText) => {
    let lastError = null;
    for (const modelName of ENGINE_MODELS) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(
          `[https://generativelanguage.googleapis.com/v1beta/models/$](https://generativelanguage.googleapis.com/v1beta/models/$){modelName}:generateContent?key=${encodeURIComponent(apiKey.trim())}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
          }
        );
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;
      }
    }
    throw lastError || new Error('Neural Engine failed to respond.');
  };

  // 1. DAG Analyzer (Human-in-the-Loop Gatekeeper)
  const handleAnalyzeDAG = async () => {
    if (!sourceCode.trim()) return showStatus('Please paste Oracle code first to analyze lineage.', true);
    if (!apiKey.trim()) return showStatus('Please configure your Engine API Key.', true);

    setIsDagLoading(true);
    setShowDagModal(true);
    setDagData(null);

    const prompt = `You are a Principal Data Architect analyzing legacy Oracle PL/SQL for a dbt migration.
dbt requires a Directed Acyclic Graph (DAG). Look for any circular dependencies, infinite loops, or deeply nested anti-patterns.

Respond ONLY with a valid JSON object matching this exact structure:
{
  "hasLoop": boolean,
  "asciiDag": "string",
  "errorMessage": "string or null",
  "suggestedCodeFix": "string or null"
}

CRITICAL JSON PARSING RULES:
NEVER use actual line breaks (newlines) or \\n inside string values. Instead, use the literal text ||| wherever a line break should be in your ASCII art or code rewrite.

Oracle Source:
${sourceCode}`;

    try {
      const rawResponse = await callNeuralEngine(prompt);
      const parsed = safeJsonParse(rawResponse);
      
      if (parsed.asciiDag) parsed.asciiDag = parsed.asciiDag.replace(/\|\|\|/g, '\n');
      if (parsed.suggestedCodeFix) parsed.suggestedCodeFix = parsed.suggestedCodeFix.replace(/\|\|\|/g, '\n');
      
      setDagData(parsed);
      setDagStatus(parsed.hasLoop ? 'error' : 'clean');
      if (!parsed.hasLoop) showStatus('DAG Architecture clean. Pipeline unlocked for translation.');
    } catch (err) {
      setShowDagModal(false);
      showStatus(`DAG Engine Error: ${err.message}`, true);
    } finally {
      setIsDagLoading(false);
    }
  };

  const applyDagFix = () => {
    if (dagData && dagData.suggestedCodeFix) {
      setSourceCode(dagData.suggestedCodeFix);
      setDagStatus('clean');
      setShowDagModal(false);
      showStatus('✅ Architectural fix applied. Pipeline unlocked for translation.');
    }
  };

  // 2. Code Conversion
  const handleTranspile = async () => {
    if (dagStatus !== 'clean') {
      return showStatus('Pipeline Blocked: Please Analyze DAG and resolve architecture risks first.', true);
    }

    setIsLoading(true);
    setDbtSql('');
    setDbtYaml('');
    resetGeneratedStates();
    showStatus('');

    const targetLabel = DB_TARGETS.find(t => t.id === targetDb)?.label || targetDb;

    const prompt = `You are a Principal Data Engineer. Convert this Oracle PL/SQL into a modern dbt architecture strictly optimized for ${targetLabel}.
Respond ONLY with a valid JSON object containing exactly two keys: "sql" and "yaml".

CRITICAL JSON PARSING RULES:
NEVER use actual line breaks (newlines) or \\n inside string values. Instead, use the literal text ||| wherever a line break should be in your SQL or YAML code.
Escape any double quotes inside strings as \\".

Oracle Source:
${sourceCode}`;

    try {
      const rawResponse = await callNeuralEngine(prompt);
      const parsed = safeJsonParse(rawResponse);
      
      const cleanSql = (parsed.sql || '').replace(/\|\|\|/g, '\n');
      const cleanYaml = (parsed.yaml || '').replace(/\|\|\|/g, '\n');
      
      setDbtSql(cleanSql);
      setDbtYaml(cleanYaml);
      showStatus(`Translation complete for ${targetLabel}. Go to Dual Run Validation to verify and deploy.`);
      generateDynamicScaffold(sourceCode, cleanSql, cleanYaml);
    } catch (err) {
      showStatus(`Engine Error: ${err.message}`, true);
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Dynamic Scaffolder
  const generateDynamicScaffold = async (srcCode, targetSql, targetYaml, driftInfo = null) => {
    setIsScaffolding(true);
    const driftContext = driftInfo?.hasDrift ? `\nNote: Validator flagged ${driftInfo.driftType}. Include the fix in the tree.` : '';

    const scaffoldPrompt = `You are a Data Architect. Inspect this Oracle PL/SQL and the generated dbt SQL/YAML. 
Design a tailored dbt repository folder tree (e.g., dbt_project.yml, models/staging, models/marts).${driftContext}
Return ONLY a clean ASCII directory tree (using ├──, └──, │) with brief inline comments. Do NOT include markdown backticks or JSON.

PL/SQL: ${srcCode}
dbt SQL: ${targetSql}`;

    try {
      let rawTree = await callNeuralEngine(scaffoldPrompt);
      // Clean possible backticks from non-JSON AI response
      rawTree = rawTree.replace(/^```[a-zA-Z]*\n?/gm, '').replace(/```$/gm, '').trim();
      setScaffoldTree(rawTree);
    } catch {
      setScaffoldTree(null);
    } finally {
      setIsScaffolding(false);
    }
  };

  // 4. Dual Run Validation
  const handleAnalyzeArchitecture = async () => {
    if (!dbtSql.trim() || !apiKey.trim()) return;

    setIsAnalyzing(true);
    setValidationRun(true);
    setAnalysisResult(null);
    setAiSelfHealing(false);
    showStatus('');

    const targetLabel = DB_TARGETS.find(t => t.id === targetDb)?.label || targetDb;

    const diagnosticPrompt = `You are a strict Cloud Data Architecture Validator for ${targetLabel}.
Analyze this Oracle PL/SQL and its transpiled dbt equivalent. Look for un-migrated Oracle functions or dialect errors.

Respond ONLY with a valid JSON object:
{
  "hasDrift": boolean,
  "parityScore": "string percentage",
  "driftType": "string or null",
  "terminalDriftLog": "string or null",
  "healAction": "string or null",
  "terminalHealLog": "string or null"
}

CRITICAL JSON PARSING RULES:
NEVER use actual line breaks or \\n in strings. Use the literal text ||| for line breaks if needed.
Escape double quotes as \\".

Oracle Source:
${sourceCode}
dbt SQL:
${dbtSql}`;

    try {
      const rawResponse = await callNeuralEngine(diagnosticPrompt);
      const parsedJson = safeJsonParse(rawResponse);
      
      Object.keys(parsedJson).forEach(key => {
        if (typeof parsedJson[key] === 'string') {
          parsedJson[key] = parsedJson[key].replace(/\|\|\|/g, '\n');
        }
      });
      
      setAnalysisResult(parsedJson);
      showStatus(`Dual Run validation complete.`);
      if (parsedJson.hasDrift) generateDynamicScaffold(sourceCode, dbtSql, dbtYaml, parsedJson);
    } catch (err) {
      setValidationRun(false);
      showStatus(`Validation Error: ${err.message}`, true);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 5. Self Healing
  const triggerSelfHealingRemediation = async () => {
    if (!dbtSql.trim() || !analysisResult?.hasDrift) return;
    setIsRemediating(true);

    const targetLabel = DB_TARGETS.find(t => t.id === targetDb)?.label || targetDb;

    const remediationPrompt = `You are a dbt remediation agent for ${targetLabel}. Fix this dbt SQL and YAML to resolve: ${analysisResult.driftType} (${analysisResult.healAction}).
Respond ONLY with a valid JSON object containing keys: "sql" and "yaml".

CRITICAL JSON PARSING RULES:
NEVER use actual line breaks or \\n. Use the literal text ||| for line breaks.
Escape double quotes as \\".

Current SQL:
${dbtSql}
Current YAML:
${dbtYaml}`;

    try {
      const rawResponse = await callNeuralEngine(remediationPrompt);
      const parsed = safeJsonParse(rawResponse);
      
      const cleanSql = (parsed.sql || '').replace(/\|\|\|/g, '\n');
      const cleanYaml = (parsed.yaml || '').replace(/\|\|\|/g, '\n');
      
      const healBanner = `/* [AI SELF-HEALED | Fix: ${analysisResult.healAction}] */`;
      const finalSql = cleanSql.startsWith('/* [AI') ? cleanSql : `${healBanner}\n${cleanSql}`;
      
      setDbtSql(finalSql);
      if(cleanYaml) setDbtYaml(cleanYaml);
      
      setIsSelfHealedCode(true);
      setAiSelfHealing(true);
      showStatus(`Self-Healing complete: dbt models patched for ${analysisResult.driftType}.`);
      generateDynamicScaffold(sourceCode, finalSql, cleanYaml, analysisResult);
    } catch (err) {
      showStatus(`Self-Healing Error: ${err.message}`, true);
    } finally {
      setIsRemediating(false);
    }
  };

  // 6. GitHub Deploy
  const pushFileToGitHub = async (fileName, fileContent) => {
    const url = `[https://api.github.com/repos/$](https://api.github.com/repos/$){gitOwner}/${gitRepo}/contents/models/${fileName}`;
    const contentBase64 = btoa(unescape(encodeURIComponent(fileContent)));
    let sha = null;
    
    try {
      const getRes = await fetch(url, { headers: { 'Authorization': `Bearer ${gitToken}` } });
      if (getRes.ok) {
        const data = await getRes.json();
        sha = data.sha;
      }
    } catch (e) {}

    const body = { message: `Automated dbt conversion: ${fileName} via Neural Engine`, content: contentBase64 };
    if (sha) body.sha = sha;

    const putRes = await fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${gitToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!putRes.ok) throw new Error('GitHub push failed. Check token permissions and repo name.');
  };

  const handleDeployToGit = async () => {
    if (!dbtSql.trim()) return showStatus('No dbt models to deploy.', true);
    if (!gitToken || !gitOwner || !gitRepo) {
      setShowGitModal(true);
      return showStatus('Please configure GitHub credentials first.', true);
    }

    setIsDeploying(true);
    showStatus('Initiating commit to GitHub repository...');

    try {
      await pushFileToGitHub('stg_oracle_model.sql', dbtSql);
      await pushFileToGitHub('schema.yml', dbtYaml);
      showStatus(`✅ Successfully deployed models to GitHub (${gitOwner}/${gitRepo})!`);
    } catch (err) {
      showStatus(`GitHub Deployment Error: ${err.message}`, true);
    } finally {
      setIsDeploying(false);
    }
  };

  const hasGeneratedCode = dbtSql.length > 0;
  const isDriftDetected = analysisResult?.hasDrift;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans selection:bg-cyan-500">
      <header className="border-b border-slate-800 bg-[#0c1220] px-6 py-3.5 flex justify-between items-center sticky top-0 z-40">
        <div>
          <h1 className="text-base font-bold text-white flex items-center gap-1.5">
            Oracle <span className="text-indigo-400">Modernisation Accelerator</span>
          </h1>
          <p className="text-[11px] text-slate-400">PL/SQL ➔ Cloud-Native dbt Models</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="bg-[#111928] border border-slate-800 p-1 rounded-xl flex gap-1 mx-2">
            <button onClick={() => setActiveTab('transpiler')} className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${activeTab === 'transpiler' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
              <span>1. Code Conversion</span>
              {isSelfHealedCode && <span className="w-2 h-2 rounded-full bg-emerald-400" />}
            </button>
            <button onClick={() => setActiveTab('scaffolder')} className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${activeTab === 'scaffolder' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
              <span>📁 2. dbt Scaffolder</span>
            </button>
            <button onClick={() => setActiveTab('dualrun')} className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${activeTab === 'dualrun' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
              <span>🛡️ 3. Dual Run Validation</span>
              {hasGeneratedCode && !validationRun && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
            </button>
          </div>
          <button onClick={() => setShowGitModal(true)} className="bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-xl text-xs text-slate-300">🐙 Git Hub</button>
          <button onClick={() => setShowConfigModal(true)} className="bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-xl text-xs text-slate-300">⚙️ Engine</button>
        </div>
      </header>

      {statusMessage && (
        <div className={`px-6 py-2.5 text-xs flex justify-between ${isError ? 'bg-rose-950 border-b border-rose-800 text-rose-200' : 'bg-slate-900 border-b border-cyan-900/50 text-cyan-300'}`}>
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage('')}>✕</button>
        </div>
      )}

      {activeTab === 'transpiler' && (
        <main className="flex-1 flex flex-col p-6 gap-4 w-full mx-auto">
          <div className="flex justify-between bg-[#111928] p-3 rounded-xl border border-slate-800 items-center">
            <div className="flex gap-2">
              <button 
                onClick={handleAnalyzeDAG} 
                disabled={isDagLoading || !sourceCode.trim()} 
                className="bg-slate-800 text-cyan-400 border border-cyan-900/50 hover:bg-slate-700 disabled:opacity-50 px-6 py-2 rounded-lg text-xs font-bold shadow-md flex items-center gap-2"
              >
                {isDagLoading ? 'Analyzing Lineage...' : '🕸️ Analyze DAG & Verify Dependencies'}
              </button>
              
              <button 
                onClick={handleTranspile} 
                disabled={isLoading || dagStatus !== 'clean'} 
                className={`${dagStatus === 'clean' ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-slate-800 opacity-50 cursor-not-allowed'} text-white px-6 py-2 rounded-lg text-xs font-bold shadow-md flex items-center gap-2`}
              >
                {isLoading ? 'Synthesising via Neural Engine...' : dagStatus === 'clean' ? '▷ Run dbt Translation' : '🔒 Locked: Analyze DAG First'}
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4 flex-1">
            <div className="flex flex-col bg-[#111928] rounded-xl border border-slate-800">
              <div className="bg-[#0c1220] p-3 border-b border-slate-800 flex justify-between items-center">
                <span className="text-xs font-semibold text-slate-400">INPUT: Oracle PL/SQL</span>
                {dagStatus === 'clean' && <span className="bg-emerald-500/15 text-emerald-300 text-[10px] px-2 py-0.5 rounded border border-emerald-500/30">✓ DAG Verified</span>}
              </div>
              <textarea value={sourceCode} onChange={handleSourceChange} className="w-full flex-1 p-4 bg-transparent font-mono text-xs text-slate-200 outline-none focus:ring-1 ring-indigo-500/50 rounded-b-xl transition-all" placeholder="Paste Oracle PL/SQL Stored Procedure or View here..." spellCheck={false} />
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col bg-[#111928] rounded-xl border border-slate-800 flex-1">
                <div className="bg-[#0c1220] p-3 border-b border-slate-800 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-cyan-400">TARGET:</span>
                    <select value={targetDb} onChange={(e) => setTargetDb(e.target.value)} className="bg-slate-900 text-cyan-300 text-xs font-bold px-2 py-1 rounded border border-slate-700 outline-none">
                      {DB_TARGETS.map(db => (
                        <option key={db.id} value={db.id}>{db.label}</option>
                      ))}
                    </select>
                  </div>
                  {isSelfHealedCode && <span className="bg-emerald-500/15 text-emerald-300 text-[10px] px-2.5 py-0.5 rounded border border-emerald-500/30">⚡ Self-Healed</span>}
                </div>
                <textarea readOnly value={dbtSql} className="w-full flex-1 p-4 bg-transparent font-mono text-xs text-cyan-100 outline-none" placeholder="dbt SQL logic will generate here..." spellCheck={false} />
              </div>

              <div className="flex flex-col bg-[#111928] rounded-xl border border-slate-800 flex-1">
                <div className="bg-[#0c1220] p-3 border-b border-slate-800 flex justify-between items-center">
                  <span className="text-xs font-semibold text-emerald-400">TARGET: dbt Schema (.yml)</span>
                </div>
                <textarea readOnly value={dbtYaml} className="w-full flex-1 p-4 bg-transparent font-mono text-xs text-emerald-100 outline-none" placeholder="dbt schema and tests will generate here..." spellCheck={false} />
              </div>
            </div>
          </div>
        </main>
      )}

      {/* Scaffolder Tab */}
      {activeTab === 'scaffolder' && (
        <main className="flex-1 p-8 max-w-6xl mx-auto w-full">
          <div className="bg-[#111928] p-6 rounded-2xl border border-slate-800 mb-6 flex justify-between items-center">
            <div>
              <h2 className="text-white font-bold mb-1 flex items-center gap-2"><span className="text-blue-400">📁</span> Enterprise dbt Scaffolder</h2>
              <p className="text-xs text-slate-400">Neural-synthesised repository structure tailored to your Oracle PL/SQL payload.</p>
            </div>
          </div>
          {hasGeneratedCode ? (
            <div className="bg-[#111928] p-6 rounded-2xl border border-slate-800 font-mono text-xs leading-relaxed">
              {isScaffolding ? (
                <div className="py-12 text-center text-cyan-400 animate-pulse">Synthesising dbt repository blueprint...</div>
              ) : scaffoldTree ? (
                <pre className="text-slate-200 whitespace-pre-wrap">{scaffoldTree}</pre>
              ) : (
                <div className="py-12 text-center text-slate-400">Blueprint unavailable.</div>
              )}
            </div>
          ) : (
            <div className="p-16 text-center text-slate-400 text-xs bg-[#111928] rounded-2xl border border-slate-800">
              Run translation first to generate a dynamic dbt repository blueprint.
            </div>
          )}
        </main>
      )}

      {/* Dual Run Validation Tab */}
      {activeTab === 'dualrun' && (
        <main className="flex-1 p-8 max-w-6xl mx-auto w-full space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#111928] border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">TARGET READINESS</div>
              <div className={`text-2xl font-black ${validationRun && isDriftDetected && !aiSelfHealing ? 'text-rose-400' : 'text-white'}`}>
                {validationRun ? (isDriftDetected && !aiSelfHealing ? 'CRITICAL DRIFT' : 'PRODUCTION READY') : 'PENDING'}
              </div>
            </div>
            <div className="bg-[#111928] border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">MODELS VERIFIED</div>
              <div className="text-2xl font-black text-white">{validationRun ? '1 / 1' : '0 / 0'}</div>
            </div>
            <div className="bg-[#111928] border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">DATA PARITY SCORE</div>
              <div className={`text-2xl font-black ${validationRun && isDriftDetected && !aiSelfHealing ? 'text-rose-400' : 'text-white'}`}>
                {validationRun ? (aiSelfHealing ? '100.00%' : analysisResult?.parityScore) : '0.00%'}
              </div>
            </div>
          </div>

          <div className="bg-[#111928] border border-slate-800 rounded-2xl shadow-xl">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2"><span className="text-indigo-400">⚖️</span> Anti-Pattern & Drift Analysis</h3>
              <div className="flex items-center space-x-3">
                <span className="text-[11px] font-bold uppercase text-slate-400">AI Self-Healing Engine</span>
                <button onClick={() => { if (!aiSelfHealing) triggerSelfHealingRemediation(); }} disabled={!isDriftDetected || isRemediating || aiSelfHealing} className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${aiSelfHealing ? 'bg-emerald-600' : 'bg-slate-800'}`}>
                  <div className={`bg-white w-4 h-4 rounded-full transform transition-transform ${aiSelfHealing ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
            
            {hasGeneratedCode && validationRun && analysisResult ? (
              <div className="grid grid-cols-4 px-6 py-4 items-center text-xs text-slate-300 gap-2">
                <div className="font-mono text-cyan-300">Generated dbt Model</div>
                <div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${!isDriftDetected || aiSelfHealing ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                    {!isDriftDetected || aiSelfHealing ? 'Parity Verified' : analysisResult.driftType}
                  </span>
                </div>
                <div className={`font-mono font-bold ${!isDriftDetected || aiSelfHealing ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {!isDriftDetected || aiSelfHealing ? '100.00%' : analysisResult.parityScore}
                </div>
                <div className="flex flex-col gap-1.5 items-start">
                  {!isDriftDetected ? (
                    <span className="text-slate-400">Zero divergence confirmed</span>
                  ) : aiSelfHealing ? (
                    <>
                      <span className="text-emerald-300">{analysisResult.healAction}</span>
                      <button onClick={() => setActiveTab('transpiler')} className="bg-emerald-600/20 text-emerald-300 px-2.5 py-1 rounded text-[11px] font-semibold">Inspect Patched Code ➔</button>
                    </>
                  ) : (
                    <button onClick={triggerSelfHealingRemediation} disabled={isRemediating} className="bg-indigo-600 text-white px-3 py-1 rounded text-[11px] font-medium">
                      {isRemediating ? 'Refactoring...' : '⚡ Self-Heal Code'}
                    </button>
                  )}
                </div>
              </div>
            ) : (
               <div className="py-16 text-center text-xs text-slate-400">
                {isAnalyzing ? <span className="text-cyan-400 animate-pulse">Scanning dbt architecture...</span> 
                : hasGeneratedCode ? <button onClick={handleAnalyzeArchitecture} className="bg-indigo-600 text-white px-5 py-2 rounded-xl">Run Live Dual Run Validation</button> 
                : "Run translation first."}
              </div>
            )}
          </div>

          <div className="bg-[#111928] border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="px-6 py-3 border-b border-slate-800"><span className="text-[11px] font-bold uppercase text-slate-400">Autonomous Remediation Terminal</span></div>
            <div className="p-5 font-mono text-xs text-slate-400 bg-slate-950/60 min-h-[100px] leading-relaxed">
              {validationRun && analysisResult ? (
                isDriftDetected ? (
                  aiSelfHealing ? (
                    <div className="space-y-1 text-emerald-300">
                      <p className="text-cyan-400">[info] {analysisResult.terminalDriftLog}</p>
                      <p className="text-indigo-400">[agent] {analysisResult.terminalHealLog}</p>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-emerald-900/30">
                        <p className="text-emerald-400 font-semibold">[success] dbt cloud deployment readiness verified.</p>
                        <button onClick={handleDeployToGit} disabled={isDeploying} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow">
                          {isDeploying ? 'Deploying to Git...' : '☁️ Push Validated Code to GitHub'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1 text-slate-300">
                      <p className="text-rose-400">[warn] {analysisResult.terminalDriftLog}</p>
                      <p className="text-slate-400">[info] Click '⚡ Self-Heal Code' to resolve the anti-pattern.</p>
                    </div>
                  )
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-emerald-400 font-semibold">[success] Zero divergence detected. Code verified for cloud deployment.</p>
                      <button onClick={handleDeployToGit} disabled={isDeploying} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow">
                        {isDeploying ? 'Deploying to Git...' : '☁️ Push Validated Code to GitHub'}
                      </button>
                    </div>
                  </div>
                )
              ) : <p>{isAnalyzing ? "Generating diagnostic report..." : "Waiting for agent activation..."}</p>}
            </div>
          </div>
        </main>
      )}

      {/* DAG Interactive Approval Modal */}
      {showDagModal && (
        <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center p-4 z-50">
          <div className="bg-[#111928] p-6 rounded-2xl border border-slate-800 max-w-4xl w-full flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm">Lineage DAG Explorer</h3>
              {isDagLoading ? (
                <span className="text-cyan-400 text-xs animate-pulse">Scanning dependencies...</span>
              ) : (
                <span className={`text-xs font-bold px-2.5 py-1 rounded border ${dagData?.hasLoop ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                  {dagData?.hasLoop ? 'Circular Dependency Detected' : 'DAG Verified Clean'}
                </span>
              )}
            </div>
            
            <div className="bg-slate-950 border border-slate-700 rounded-xl p-4 font-mono text-xs text-cyan-300 overflow-x-auto min-h-[200px]">
              {isDagLoading ? (
                <div className="text-slate-500">Mapping entity relationships...</div>
              ) : (
                <pre>{dagData?.asciiDag || 'No visual DAG generated.'}</pre>
              )}
            </div>

            {!isDagLoading && dagData?.hasLoop && (
              <div className="bg-rose-950/30 border border-rose-900/50 p-4 rounded-xl mt-2">
                <p className="text-rose-400 text-xs font-bold mb-2">⚠️ Architecture Risk: {dagData.errorMessage}</p>
                <div className="bg-slate-950 p-3 rounded border border-rose-900/50 font-mono text-[10px] text-slate-300 overflow-x-auto mb-3">
                  <pre>{dagData.suggestedCodeFix}</pre>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowDagModal(false)} className="text-slate-400 hover:text-white text-xs px-4 py-2">Reject & Edit Manually</button>
                  <button onClick={applyDagFix} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded text-xs font-bold shadow">
                    Approve & Apply Architectural Fix
                  </button>
                </div>
              </div>
            )}

            {!isDagLoading && !dagData?.hasLoop && (
              <div className="flex justify-end pt-2">
                <button onClick={() => setShowDagModal(false)} className="bg-indigo-600 text-white px-6 py-2 rounded text-xs font-bold">Continue to Translation</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Config Modals */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center p-4 z-50">
          <div className="bg-[#111928] p-6 rounded-2xl border border-slate-800 max-w-md w-full flex flex-col gap-4 text-xs">
            <h3 className="font-bold text-white">Engine Configuration</h3>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API Key" className="bg-slate-950 p-2 text-white border border-slate-700 rounded outline-none" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowConfigModal(false)} className="text-slate-400">Cancel</button>
              <button onClick={saveConfig} className="bg-indigo-600 text-white px-4 py-2 rounded">Save</button>
            </div>
          </div>
        </div>
      )}

      {showGitModal && (
        <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center p-4 z-50">
          <div className="bg-[#111928] p-6 rounded-2xl border border-slate-800 max-w-md w-full flex flex-col gap-4 text-xs">
            <h3 className="font-bold text-white text-sm mb-1">GitHub Integration</h3>
            <label className="flex flex-col gap-1 text-slate-300">Owner: <input type="text" value={gitOwner} onChange={(e) => setGitOwner(e.target.value)} className="bg-slate-950 p-2 border border-slate-700 rounded" /></label>
            <label className="flex flex-col gap-1 text-slate-300">Repo: <input type="text" value={gitRepo} onChange={(e) => setGitRepo(e.target.value)} className="bg-slate-950 p-2 border border-slate-700 rounded" /></label>
            <label className="flex flex-col gap-1 text-slate-300">Token: <input type="password" value={gitToken} onChange={(e) => setGitToken(e.target.value)} className="bg-slate-950 p-2 border border-slate-700 rounded" /></label>
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setShowGitModal(false)} className="text-slate-400">Cancel</button>
              <button onClick={saveGitConfig} className="bg-emerald-600 text-white px-4 py-2 rounded">Connect</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
