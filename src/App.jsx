import React, { useState } from 'react';

const ENGINE_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite'
];

export default function App() {
  const [sourceCode, setSourceCode] = useState('');
  const [dbtSql, setDbtSql] = useState('');
  const [dbtYaml, setDbtYaml] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [isError, setIsError] = useState(false);

  // Modals
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showGitModal, setShowGitModal] = useState(false);

  // API Keys & Config
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('oracle_engine_key') || '');
  const [gitToken, setGitToken] = useState(() => localStorage.getItem('github_pat') || '');
  const [gitOwner, setGitOwner] = useState(() => localStorage.getItem('github_owner') || '');
  const [gitRepo, setGitRepo] = useState(() => localStorage.getItem('github_repo') || '');

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
    showStatus('GitHub configuration saved. Ready for deployment.');
  };

  const showStatus = (msg, error = false) => {
    setStatusMessage(msg);
    setIsError(error);
  };

  const callNeuralEngine = async (promptText) => {
    let lastError = null;
    for (const modelName of ENGINE_MODELS) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey.trim())}`,
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
        let rawCode = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return rawCode.replace(/^```[a-z]*\n?|^```\n?|```$/gm, '').trim();
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;
      }
    }
    throw lastError || new Error('Neural Engine failed to respond.');
  };

  const handleTranspile = async () => {
    if (!sourceCode.trim()) return showStatus('Please paste Oracle PL/SQL code first.', true);
    if (!apiKey.trim()) return showStatus('Please configure your Engine API Key.', true);

    setIsLoading(true);
    setDbtSql('');
    setDbtYaml('');
    showStatus('');

    const prompt = `You are a Principal Data Engineer. Convert this Oracle PL/SQL into a modern dbt architecture.
    Respond ONLY with a valid JSON object containing exactly two keys: "sql" and "yaml".
    - "sql": The dbt SELECT model (handle NVL to COALESCE, SYSDATE to CURRENT_TIMESTAMP, etc.).
    - "yaml": The dbt schema.yml definition with standard tests (unique, not_null).
    NO markdown formatting, NO backticks, ONLY raw JSON.
    
    Oracle Source:
    ${sourceCode}`;

    try {
      const jsonResponse = await callNeuralEngine(prompt);
      const parsed = JSON.parse(jsonResponse);
      setDbtSql(parsed.sql || '');
      setDbtYaml(parsed.yaml || '');
      showStatus('Translation complete. Code ready for GitHub deployment.');
    } catch (err) {
      showStatus(`Engine Error: Ensure AI returns valid JSON. ${err.message}`, true);
    } finally {
      setIsLoading(false);
    }
  };

  // REAL-TIME GITHUB PUSH LOGIC
  const pushFileToGitHub = async (fileName, fileContent) => {
    const url = `[https://api.github.com/repos/$](https://api.github.com/repos/$){gitOwner}/${gitRepo}/contents/models/${fileName}`;
    const contentBase64 = btoa(unescape(encodeURIComponent(fileContent)));

    // 1. Check if file already exists to get its SHA (required for updating files in GitHub)
    let sha = null;
    try {
      const getRes = await fetch(url, { headers: { 'Authorization': `Bearer ${gitToken}` } });
      if (getRes.ok) {
        const data = await getRes.json();
        sha = data.sha;
      }
    } catch (e) {}

    // 2. Commit the file
    const body = {
      message: `Automated dbt conversion: ${fileName} via Neural Engine`,
      content: contentBase64,
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${gitToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!putRes.ok) {
      const err = await putRes.json();
      throw new Error(err.message || 'GitHub push failed');
    }
  };

  const handleDeployToGit = async () => {
    if (!dbtSql.trim()) return showStatus('No dbt models to deploy. Run translation first.', true);
    if (!gitToken || !gitOwner || !gitRepo) {
      setShowGitModal(true);
      return showStatus('Please configure GitHub integration credentials.', true);
    }

    setIsDeploying(true);
    showStatus('Initiating commit to GitHub repository...');

    try {
      await pushFileToGitHub('stg_oracle_model.sql', dbtSql);
      await pushFileToGitHub('schema.yml', dbtYaml);
      showStatus(`✅ Successfully deployed models to GitHub (${gitOwner}/${gitRepo})! CI/CD Pipeline triggered.`);
    } catch (err) {
      showStatus(`GitHub Deployment Error: ${err.message}`, true);
    } finally {
      setIsDeploying(false);
    }
  };

  const hasGeneratedCode = dbtSql.length > 0;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans selection:bg-cyan-500">
      <header className="border-b border-slate-800 bg-[#0c1220] px-6 py-3.5 flex justify-between items-center sticky top-0 z-40">
        <div>
          <h1 className="text-base font-bold text-white flex items-center gap-1.5">
            Oracle <span className="text-indigo-400">Modernisation Accelerator</span>
          </h1>
          <p className="text-[11px] text-slate-400">PL/SQL ➔ Cloud-Native dbt Models</p>
        </div>
        <div className="flex gap-2">
          {hasGeneratedCode && (
            <button 
              onClick={handleDeployToGit}
              disabled={isDeploying}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded-xl text-xs font-bold shadow flex items-center gap-2"
            >
              {isDeploying ? 'Deploying...' : '☁️ Push to GitHub'}
            </button>
          )}
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

      <main className="flex-1 flex flex-col p-6 gap-4 w-full mx-auto max-w-7xl">
        <div className="flex justify-between bg-[#111928] p-3 rounded-xl border border-slate-800 items-center">
          <button onClick={handleTranspile} disabled={isLoading} className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 px-6 py-2 rounded-lg text-xs font-bold shadow-md">
            {isLoading ? 'Synthesising via Neural Engine...' : '▷ Run dbt Translation'}
          </button>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1">
          {/* SOURCE PANEL */}
          <div className="flex flex-col bg-[#111928] rounded-xl border border-slate-800">
            <div className="bg-[#0c1220] p-3 border-b border-slate-800 flex justify-between items-center">
              <span className="text-xs font-semibold text-slate-400">INPUT: Legacy Oracle PL/SQL</span>
            </div>
            <textarea value={sourceCode} onChange={(e) => setSourceCode(e.target.value)} className="w-full flex-1 p-4 bg-transparent font-mono text-xs text-slate-200 outline-none" placeholder="Paste Oracle PL/SQL Stored Procedure or View here..." spellCheck={false} />
          </div>

          {/* TARGET PANEL */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col bg-[#111928] rounded-xl border border-slate-800 flex-1">
              <div className="bg-[#0c1220] p-3 border-b border-slate-800 flex justify-between items-center">
                <span className="text-xs font-semibold text-cyan-400">TARGET: dbt Model (.sql)</span>
              </div>
              <textarea readOnly value={dbtSql} className="w-full flex-1 p-4 bg-transparent font-mono text-xs text-cyan-100 outline-none" placeholder="dbt SQL logic will generate here..." spellCheck={false} />
            </div>

            <div className="flex flex-col bg-[#111928] rounded-xl border border-slate-800 flex-1">
              <div className="bg-[#0c1220] p-3 border-b border-slate-800 flex justify-between items-center">
                <span className="text-xs font-semibold text-emerald-400">TARGET: dbt Schema (.yml)</span>
              </div>
              <textarea readOnly value={dbtYaml} className="w-full flex-1 p-4 bg-transparent font-mono text-xs text-emerald-100 outline-none" placeholder="dbt schema and test configurations will generate here..." spellCheck={false} />
            </div>
          </div>
        </div>
      </main>

      {/* Engine Config Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center p-4 z-50">
          <div className="bg-[#111928] p-6 rounded-2xl border border-slate-800 max-w-md w-full flex flex-col gap-4 text-xs">
            <h3 className="font-bold text-white">Modernisation Engine Configuration</h3>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Engine API Key" className="bg-slate-950 p-2 text-white border border-slate-700 rounded outline-none" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowConfigModal(false)} className="text-slate-400 hover:text-white">Cancel</button>
              <button onClick={saveConfig} className="bg-indigo-600 text-white px-4 py-2 rounded font-semibold">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* GitHub Integration Modal */}
      {showGitModal && (
        <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center p-4 z-50">
          <div className="bg-[#111928] p-6 rounded-2xl border border-slate-800 max-w-md w-full flex flex-col gap-4 text-xs">
            <div>
              <h3 className="font-bold text-white text-sm mb-1">GitHub Integration</h3>
              <p className="text-slate-400">Connect to your repository to push converted dbt models automatically.</p>
            </div>
            
            <label className="flex flex-col gap-1 text-slate-300">
              GitHub Owner / Organization:
              <input type="text" value={gitOwner} onChange={(e) => setGitOwner(e.target.value)} placeholder="e.g., your-username" className="bg-slate-950 p-2 text-white border border-slate-700 rounded outline-none" />
            </label>

            <label className="flex flex-col gap-1 text-slate-300">
              Repository Name:
              <input type="text" value={gitRepo} onChange={(e) => setGitRepo(e.target.value)} placeholder="e.g., dbt-migration-project" className="bg-slate-950 p-2 text-white border border-slate-700 rounded outline-none" />
            </label>

            <label className="flex flex-col gap-1 text-slate-300">
              Personal Access Token (PAT):
              <input type="password" value={gitToken} onChange={(e) => setGitToken(e.target.value)} placeholder="ghp_xxxxxxxxxxxx" className="bg-slate-950 p-2 text-white border border-slate-700 rounded outline-none" />
              <span className="text-[10px] text-slate-500">Requires 'repo' scope. Tokens are saved locally in your browser.</span>
            </label>

            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setShowGitModal(false)} className="text-slate-400 hover:text-white">Cancel</button>
              <button onClick={saveGitConfig} className="bg-emerald-600 text-white px-4 py-2 rounded font-semibold">Connect to GitHub</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
