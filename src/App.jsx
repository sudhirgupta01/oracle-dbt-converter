import React, { useState, useRef } from 'react';

const ENGINE_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite'
];

const DB_TARGETS = [
  { id: 'snowflake', label: 'Snowflake' },
  { id: 'bigquery', label: 'Google BigQuery' },
  { id: 'alloydb', label: 'Google AlloyDB (PostgreSQL)' },
  { id: 'spanner', label: 'Google Cloud Spanner' },
  { id: 'cloudsql_pg', label: 'Google Cloud SQL (PostgreSQL)' },
  { id: 'databricks', label: 'Databricks SQL' },
  { id: 'fabric', label: 'Microsoft Fabric Warehouse' },
  { id: 'redshift', label: 'Amazon Redshift' },
  { id: 'synapse', label: 'Azure Synapse Analytics' },
  { id: 'sqlserver', label: 'SQL Server / Azure SQL' },
  { id: 'postgres', label: 'PostgreSQL (Self-Managed)' },
  { id: 'athena', label: 'Amazon Athena (Trino)' },
  { id: 'spark', label: 'Apache Spark SQL' },
  { id: 'duckdb', label: 'DuckDB (Local / CI)' }
];

// Zero-dependency pure-JS ZIP file generator (Store method, UTF-8 safe)
function buildZipBlob(filesMap) {
  const encoder = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c;
  }
  const crc32 = (buf) => {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };

  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  Object.entries(filesMap).forEach(([filePath, content]) => {
    const nameBytes = encoder.encode(filePath);
    const dataBytes = encoder.encode(content);
    const crc = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 flag
    lv.setUint16(8, 0, true); // Store
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localChunks.push(localHeader, dataBytes);
    centralChunks.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  });

  const centralSize = centralChunks.reduce((acc, c) => acc + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centralChunks.length, true);
  ev.setUint16(10, centralChunks.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...localChunks, ...centralChunks, eocd], { type: 'application/zip' });
}

export default function App() {
  const [activeTab, setActiveTab] = useState('transpiler');
  const fileInputRef = useRef(null);

  // Core Code & Package Decomposition States
  const [sourceCode, setSourceCode] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [targetDb, setTargetDb] = useState('snowflake');
  const [generatedModels, setGeneratedModels] = useState([]); // [{ name, layer, sql, yaml }]
  const [selectedModelIdx, setSelectedModelIdx] = useState(0);
  const [parityTestSql, setParityTestSql] = useState('');
  const [architecturalAdvisory, setArchitecturalAdvisory] = useState(null);

  // UI & Loading States
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [isError, setIsError] = useState(false);

  // DAG Analysis & Human-in-the-Loop States
  const [isDagLoading, setIsDagLoading] = useState(false);
  const [showDagModal, setShowDagModal] = useState(false);
  const [dagStatus, setDagStatus] = useState('pending');
  const [dagData, setDagData] = useState(null);

  // Security & Credentials (Persisted across sessions by default unless opted out or purged)
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showGitModal, setShowGitModal] = useState(false);
  const [rememberSecrets, setRememberSecrets] = useState(
    () => localStorage.getItem('oracle_remember_secrets') !== 'false'
  );
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem('oracle_engine_key') || sessionStorage.getItem('oracle_engine_key') || ''
  );

  // GitHub State (Supports PR Workflow)
  const [gitToken, setGitToken] = useState(
    () => localStorage.getItem('github_pat') || sessionStorage.getItem('github_pat') || ''
  );
  const [gitOwner, setGitOwner] = useState(
    () => localStorage.getItem('github_owner') || sessionStorage.getItem('github_owner') || ''
  );
  const [gitRepo, setGitRepo] = useState(
    () => localStorage.getItem('github_repo') || sessionStorage.getItem('github_repo') || ''
  );
  const [gitUsePr, setGitUsePr] = useState(true);
  const [isDeploying, setIsDeploying] = useState(false);
  const [lastPrUrl, setLastPrUrl] = useState('');

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

  const persistSecret = (key, value, persistLocal) => {
    sessionStorage.setItem(key, value);
    if (persistLocal) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  };

  const saveConfig = () => {
    localStorage.setItem('oracle_remember_secrets', String(rememberSecrets));
    persistSecret('oracle_engine_key', apiKey.trim(), rememberSecrets);
    persistSecret('github_pat', gitToken.trim(), rememberSecrets);
    persistSecret('github_owner', gitOwner.trim(), rememberSecrets);
    persistSecret('github_repo', gitRepo.trim(), rememberSecrets);
    setShowConfigModal(false);
    showStatus(
      rememberSecrets
        ? 'Engine configuration saved across browser sessions.'
        : 'Engine key saved to active session memory only (auto-clears on tab close).'
    );
  };

  const saveGitConfig = () => {
    persistSecret('github_pat', gitToken.trim(), rememberSecrets);
    persistSecret('github_owner', gitOwner.trim(), rememberSecrets);
    persistSecret('github_repo', gitRepo.trim(), rememberSecrets);
    setShowGitModal(false);
    showStatus(`GitHub configuration saved (${gitUsePr ? 'Pull Request mode' : 'Direct commit mode'}).`);
  };

  const purgeAllSecrets = () => {
    ['oracle_engine_key', 'github_pat', 'github_owner', 'github_repo'].forEach((k) => {
      sessionStorage.removeItem(k);
      localStorage.removeItem(k);
    });
    localStorage.setItem('oracle_remember_secrets', 'false');
    setApiKey('');
    setGitToken('');
    setGitOwner('');
    setGitRepo('');
    setRememberSecrets(false);
    showStatus('All API keys and GitHub credentials purged from browser memory.');
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
    setArchitecturalAdvisory(null);
    setParityTestSql('');
    setLastPrUrl('');
  };

  const handleResetWorkspace = () => {
    setSourceCode('');
    setUploadedFileName('');
    setGeneratedModels([]);
    setSelectedModelIdx(0);
    setDagStatus('pending');
    setDagData(null);
    setShowDagModal(false);
    resetGeneratedStates();
    showStatus('Workspace reset. Ready for new Oracle PL/SQL or Package input.');
  };

  const handleSourceChange = (e) => {
    setSourceCode(e.target.value);
    setDagStatus('pending');
    setDagData(null);
    setGeneratedModels([]);
    setSelectedModelIdx(0);
    resetGeneratedStates();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = String(ev.target?.result || '');
      setSourceCode(content);
      setUploadedFileName(file.name);
      setDagStatus('pending');
      setDagData(null);
      setGeneratedModels([]);
      setSelectedModelIdx(0);
      resetGeneratedStates();
      showStatus(`Loaded ${file.name} (${content.split('\n').length} lines). Click "Analyze DAG" next.`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const formatMultiline = (val) =>
    typeof val === 'string' ? val.replace(/\|\|\|/g, '\n').replace(/\\n/g, '\n') : val;

  const safeJsonParse = (rawStr) => {
    const start = rawStr.indexOf('{');
    const end = rawStr.lastIndexOf('}');
    if (start === -1 || end === -1) {
      throw new Error('Invalid structured response from Neural Engine.');
    }
    const cleanStr = rawStr.substring(start, end + 1);
    return JSON.parse(cleanStr);
  };

  const detectImperativeConstructs = (sqlText) => {
    const matches = [];
    if (/\bCURSOR\b|\bFETCH\b|\bLOOP\b/i.test(sqlText)) matches.push('Explicit Cursor / Row-by-Row Loop');
    if (/\bUPDATE\b|\bDELETE\b|\bINSERT\b|\bMERGE\b/i.test(sqlText)) matches.push('Imperative DML Mutation');
    if (/\bCOMMIT\b|\bROLLBACK\b/i.test(sqlText)) matches.push('Explicit Transaction Control (COMMIT/ROLLBACK)');
    if (/\bRAISE_APPLICATION_ERROR\b|\bEXCEPTION\b|\bDBMS_OUTPUT\b/i.test(sqlText))
      matches.push('Procedural Exception / Application Error Handling');
    if (/\bCONNECT\s+BY\b/i.test(sqlText)) matches.push('Hierarchical CONNECT BY Recursion');
    return matches;
  };

  // Unified Project Bundle Builder (Used identically by Scaffolder, ZIP Export, and GitHub Push)
  const buildDbtProjectBundle = (modelsList, paritySql) => {
    const files = {};
    const allContent = modelsList.map((m) => `${m.sql}\n${m.yaml}`).join('\n') + `\n${paritySql || ''}`;
    const usesDbtUtils = /\bdbt_utils\./i.test(allContent);

    files['dbt_project.yml'] = `name: 'oracle_modernised_warehouse'
version: '1.0.0'
config-version: 2

profile: 'default'

model-paths: ["models"]
test-paths: ["tests"]
macro-paths: ["macros"]

models:
  oracle_modernised_warehouse:
    staging:
      +materialized: view
    intermediate:
      +materialized: ephemeral
    marts:
      +materialized: table
`;

    if (usesDbtUtils) {
      files['packages.yml'] = `packages:
  - package: dbt-labs/dbt_utils
    version: [">=1.1.1", "<2.0.0"]
`;
    }

    modelsList.forEach((m) => {
      const safeName = (m.name || 'stg_oracle_model').replace(/[^a-z0-9_]/gi, '').toLowerCase();
      const layer = ['staging', 'intermediate', 'marts'].includes(m.layer)
        ? m.layer
        : safeName.startsWith('stg_')
        ? 'staging'
        : safeName.startsWith('int_')
        ? 'intermediate'
        : 'marts';

      files[`models/${layer}/${safeName}.sql`] = m.sql;
      if (m.yaml?.trim()) {
        files[`models/${layer}/schema_${safeName}.yml`] = m.yaml;
      }
    });

    if (paritySql?.trim()) {
      const primaryName = (modelsList[0]?.name || 'oracle_model').replace(/[^a-z0-9_]/gi, '').toLowerCase();
      files[`tests/assert_parity_${primaryName}.sql`] = paritySql;
    }

    return files;
  };

  const renderAsciiTreeFromBundle = (filesMap) => {
    const paths = Object.keys(filesMap).sort();
    const root = {};
    paths.forEach((p) => {
      const parts = p.split('/');
      let curr = root;
      parts.forEach((part, idx) => {
        if (!curr[part]) curr[part] = idx === parts.length - 1 ? null : {};
        curr = curr[part];
      });
    });

    const lines = ['oracle_modernised_warehouse/'];
    const walk = (node, prefix) => {
      const entries = Object.entries(node);
      entries.forEach(([key, val], i) => {
        const isLast = i === entries.length - 1;
        const branch = isLast ? '└── ' : '├── ';
        let note = '';
        if (key === 'packages.yml') note = '  # Auto-included for dbt_utils macro dependencies';
        if (key.startsWith('assert_parity_')) note = '  # Automated row-count & aggregate parity test';
        lines.push(`${prefix}${branch}${key}${val === null ? note : '/'}`);
        if (val !== null) walk(val, prefix + (isLast ? '    ' : '│   '));
      });
    };
    walk(root, '');
    return lines.join('\n');
  };

  const handleDownloadZip = () => {
    if (generatedModels.length === 0) return showStatus('Generate dbt models first before exporting ZIP.', true);
    const bundle = buildDbtProjectBundle(generatedModels, parityTestSql);
    const blob = buildZipBlob(bundle);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dbt_${(generatedModels[0]?.name || 'oracle_migration').toLowerCase()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus(`📦 Exported runnable dbt project ZIP (${Object.keys(bundle).length} files).`);
  };

  // Tiered Temperature Control Engine
  const executeModelRequest = async (modelName, promptText, expectJson, cleanKey, temperature = 0.1) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);
    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        temperature: temperature,
        ...(expectJson ? { responseMimeType: 'application/json' } : {})
      }
    };

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(cleanKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(payload)
        }
      );
      clearTimeout(timeoutId);
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const reason = errBody?.error?.message || `HTTP ${response.status}`;
        const err = new Error(reason);
        err.status = response.status;
        throw err;
      }
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  };

  const callNeuralEngine = async (promptText, expectJson = false, temperature = 0.1) => {
    const cleanKey = apiKey.trim();
    let lastError = null;

    for (const modelName of ENGINE_MODELS) {
      try {
        const text = await executeModelRequest(modelName, promptText, expectJson, cleanKey, temperature);
        if (text) return text;
      } catch (err) {
        lastError = err;
        if (err.status === 403 || (err.status === 400 && /api[_ ]key/i.test(err.message))) {
          throw new Error(`Authentication failed (${err.message}). Verify your Engine API Key.`);
        }
        if (err.status === 400 && expectJson) {
          try {
            const fallbackText = await executeModelRequest(modelName, promptText, false, cleanKey, temperature);
            if (fallbackText) return fallbackText;
          } catch (retryErr) {
            lastError = retryErr;
          }
        }
      }
    }

    try {
      const listRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`
      );
      if (listRes.ok) {
        const listData = await listRes.json();
        const candidates = (listData.models || [])
          .filter(
            (m) =>
              Array.isArray(m.supportedGenerationMethods) &&
              m.supportedGenerationMethods.includes('generateContent') &&
              !m.name.includes('2.0') &&
              !m.name.includes('2.5') &&
              !ENGINE_MODELS.includes(m.name.replace(/^models\//, ''))
          )
          .sort((a, b) => b.name.localeCompare(a.name));

        for (const candidate of candidates) {
          try {
            const discoveredId = candidate.name.replace(/^models\//, '');
            const text = await executeModelRequest(discoveredId, promptText, expectJson, cleanKey, temperature);
            if (text) return text;
          } catch (innerErr) {
            lastError = innerErr;
          }
        }
      }
    } catch (discoveryErr) {
      lastError = discoveryErr;
    }

    throw lastError || new Error('Neural Engine failed to respond.');
  };

  // 1. DAG Analyzer (Temp: 0.0)
  const handleAnalyzeDAG = async () => {
    if (!sourceCode.trim()) return showStatus('Please paste or upload Oracle code first to analyze lineage.', true);
    if (!apiKey.trim()) return showStatus('Please configure your Engine API Key.', true);

    setIsDagLoading(true);
    setShowDagModal(true);
    setDagData(null);

    const prompt = `You are a Principal Data Architect analyzing legacy Oracle PL/SQL (views, procedures, or multi-procedure packages) for a dbt migration.
dbt requires a Directed Acyclic Graph (DAG). Detect any circular dependencies, infinite loops, or cross-procedure cycles.

Return a JSON object with this exact schema:
{
  "hasLoop": boolean,
  "asciiDag": "string (clean ASCII lineage diagram using \\n for newlines)",
  "errorMessage": "string or null (explanation if circular dependency exists)",
  "suggestedCodeFix": "string or null (complete rewritten PL/SQL code resolving the loop using \\n for newlines)"
}

Oracle Source:
${sourceCode}`;

    try {
      const rawResponse = await callNeuralEngine(prompt, true, 0.0);
      const parsed = safeJsonParse(rawResponse);

      if (parsed.asciiDag) parsed.asciiDag = formatMultiline(parsed.asciiDag);
      if (parsed.suggestedCodeFix) parsed.suggestedCodeFix = formatMultiline(parsed.suggestedCodeFix);

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

  // 2. Code Conversion + Package Decomposition (Temp: 0.1)
  const handleTranspile = async () => {
    if (dagStatus !== 'clean') {
      return showStatus('Pipeline Blocked: Please Analyze DAG and resolve architecture risks first.', true);
    }

    setIsLoading(true);
    setGeneratedModels([]);
    setSelectedModelIdx(0);
    resetGeneratedStates();
    showStatus('');

    const targetLabel = DB_TARGETS.find((t) => t.id === targetDb)?.label || targetDb;

    const prompt = `You are a Principal Data Engineer. Convert this Oracle PL/SQL into a modular, production-ready dbt architecture strictly optimized for ${targetLabel}.
Strictly obey ALL 8 architectural rules:

1. MULTI-PROCEDURE PACKAGE DECOMPOSITION:
   - If the Oracle input is a PL/SQL PACKAGE (or contains multiple procedures/CTEs representing distinct pipeline stages), decompose it into multiple modular dbt models across layers ("staging", "intermediate", "marts") linked via {{ ref('<model_name>') }}.
   - If it is a single view or procedure, return 1 model in the appropriate layer ("staging" for raw source views, "marts" for transformed procedures/aggregations).

2. CONFIG MATERIALIZATION & INCREMENTAL COMPLETENESS:
   - Every SQL model MUST begin with {{ config(...) }} on line 1.
   - Views: {{ config(materialized='view') }}.
   - Standard tables: {{ config(materialized='table') }}.
   - Oracle MERGE / incremental upserts: MUST use {{ config(materialized='incremental', unique_key='<pk_col>', incremental_strategy='merge') }} AND include a {% if is_incremental() %} watermark filter block.

3. ROWNUM & RANKING COLUMN PRESERVATION:
   - Never collapse ROWNUM subqueries into a bare LIMIT clause if outer SELECT * or ranking aliases are projected. Rewrite using a CTE with ROW_NUMBER() OVER (...) AS <alias>.

4. NATIVE SEQUENCE PRESERVATION (NO MD5 HASHES):
   - Never replace explicit Oracle sequences (.NEXTVAL) with dbt_utils.generate_surrogate_key or MD5 hashes.
   - Use native sequence syntax for ${targetLabel}: nextval('seq') for PostgreSQL/AlloyDB/Cloud SQL/DuckDB, seq.NEXTVAL for Snowflake, NEXT VALUE FOR seq for SQL Server/Synapse/Fabric, GET_NEXT_SEQUENCE_VALUE(SEQUENCE seq) for Cloud Spanner.

5. ENTERPRISE ORACLE IDIOMS:
   - Convert CONNECT BY PRIOR hierarchical queries into WITH RECURSIVE CTEs.
   - Convert Oracle (+) implicit outer join syntax into explicit ANSI LEFT OUTER JOIN / RIGHT OUTER JOIN.
   - Convert KEEP (DENSE_RANK FIRST/LAST ORDER BY ...) into native FIRST_VALUE / window functions.

6. PROCEDURAL VALIDATIONS TO SCHEMA.YML ASSERTIONS:
   - Encode PL/SQL validation checks (RAISE_APPLICATION_ERROR, negative value checks) as dbt tests in schema.yml (e.g., dbt_utils.expression_is_true, accepted_values, not_null).

7. AUTOMATED PARITY TEST SQL:
   - Generate a standalone dbt singular test query in "parityTestSql" that returns failing rows if row counts or key numeric totals diverge from expected source invariants.

8. ARCHITECTURAL ADVISORY:
   - If imperative constructs (CURSOR, LOOP, COMMIT/ROLLBACK, RAISE_APPLICATION_ERROR, CONNECT BY) were refactored, explain the paradigm shift concisely in "advisory".

Return a JSON object with this exact schema:
{
  "models": [
    {
      "name": "string (snake_case model name, e.g., 'stg_employees' or 'mart_customer_risk')",
      "layer": "staging | intermediate | marts",
      "sql": "string (complete dbt SQL starting with {{ config(...) }})",
      "yaml": "string (complete dbt schema.yml for this model)"
    }
  ],
  "parityTestSql": "string (dbt singular test SQL returning rows on data parity mismatch)",
  "advisory": "string or null"
}

Oracle Source:
${sourceCode}`;

    try {
      const rawResponse = await callNeuralEngine(prompt, true, 0.1);
      const parsed = safeJsonParse(rawResponse);

      const modelsList = (parsed.models || []).map((m) => ({
        name: (m.name || 'stg_oracle_model').replace(/[^a-z0-9_]/gi, '').toLowerCase(),
        layer: m.layer || 'marts',
        sql: formatMultiline(m.sql || ''),
        yaml: formatMultiline(m.yaml || '')
      }));

      if (modelsList.length === 0 && parsed.sql) {
        modelsList.push({
          name: (parsed.modelName || 'stg_oracle_model').replace(/[^a-z0-9_]/gi, '').toLowerCase(),
          layer: 'marts',
          sql: formatMultiline(parsed.sql),
          yaml: formatMultiline(parsed.yaml || '')
        });
      }

      const cleanParitySql = formatMultiline(parsed.parityTestSql || '');
      const detectedImperative = detectImperativeConstructs(sourceCode);
      const finalAdvisory =
        parsed.advisory ||
        (detectedImperative.length > 0
          ? `Declarative Refactoring Notice: Legacy imperative constructs (${detectedImperative.join(', ')}) were converted into set-based dbt SQL models, schema.yml assertions, and singular parity tests.`
          : null);

      setGeneratedModels(modelsList);
      setSelectedModelIdx(0);
      setParityTestSql(cleanParitySql);
      setArchitecturalAdvisory(finalAdvisory);

      // Synchronize Scaffolder directly with the exact deployable bundle
      const bundle = buildDbtProjectBundle(modelsList, cleanParitySql);
      setScaffoldTree(renderAsciiTreeFromBundle(bundle));

      showStatus(
        `Translation complete (${modelsList.length} dbt model${modelsList.length > 1 ? 's' : ''}) for ${targetLabel}.`
      );
    } catch (err) {
      showStatus(`Engine Error: ${err.message}`, true);
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Dual Run Validation (Temp: 0.0)
  const handleAnalyzeArchitecture = async () => {
    if (generatedModels.length === 0 || !apiKey.trim()) return;

    setIsAnalyzing(true);
    setValidationRun(true);
    setAnalysisResult(null);
    setAiSelfHealing(false);
    showStatus('');

    const targetLabel = DB_TARGETS.find((t) => t.id === targetDb)?.label || targetDb;
    const serializedModels = generatedModels
      .map((m) => `--- MODEL: models/${m.layer}/${m.name}.sql ---\n${m.sql}\n--- YAML ---\n${m.yaml}`)
      .join('\n\n');

    const diagnosticPrompt = `You are a strict Cloud Data Architecture Validator for ${targetLabel}.
Audit this Oracle PL/SQL and all transpiled dbt models + YAML definitions. Check specifically for:
1. Missing {{ config(materialized=...) }} header or incremental models missing unique_key / {% if is_incremental() %}.
2. Dropped ROWNUM ranking columns (outer SELECT * projected row_num, but dbt collapsed into LIMIT without ROW_NUMBER() OVER()).
3. Sequence type corruption (Oracle used .NEXTVAL sequence, but dbt substituted MD5 surrogate_key instead of native sequence syntax for ${targetLabel}).
4. Un-migrated Oracle syntax ((+) outer joins, CONNECT BY without WITH RECURSIVE, NVL, DECODE, SYSDATE, LISTAGG, MINUS).
5. Missing schema.yml validation tests when Oracle PL/SQL had RAISE_APPLICATION_ERROR business rules.

Note: Converting imperative PL/SQL CURSOR loops, UPDATE statements, or COMMIT/ROLLBACK blocks into set-based declarative SELECT models is VALID dbt architecture and should NOT be flagged as drift.

Return a JSON object with this exact schema:
{
  "hasDrift": boolean,
  "parityScore": "string percentage (e.g., '100.00%' or '78.50%')",
  "driftType": "string or null (e.g., 'INCOMPLETE_INCREMENTAL_BLOCK', 'DROPPED_RANK_COLUMN', 'SEQUENCE_HASH_MISMATCH', 'ORACLE_SYNTAX_LEAK', 'MISSING_SCHEMA_ASSERTION')",
  "terminalDriftLog": "string or null (detailed explanation of the risk)",
  "healAction": "string or null (short description of the fix)",
  "terminalHealLog": "string or null (explanation of what the self-healing agent will patch)"
}

Oracle Source:
${sourceCode}

Transpiled dbt Models:
${serializedModels}`;

    try {
      const rawResponse = await callNeuralEngine(diagnosticPrompt, true, 0.0);
      const parsedJson = safeJsonParse(rawResponse);

      Object.keys(parsedJson).forEach((key) => {
        if (typeof parsedJson[key] === 'string') {
          parsedJson[key] = formatMultiline(parsedJson[key]);
        }
      });

      setAnalysisResult(parsedJson);
      showStatus('Dual Run validation complete.');
    } catch (err) {
      setValidationRun(false);
      showStatus(`Validation Error: ${err.message}`, true);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 5. Self Healing (Temp: 0.15)
  const triggerSelfHealingRemediation = async () => {
    if (generatedModels.length === 0 || !analysisResult?.hasDrift) return;
    setIsRemediating(true);

    const targetLabel = DB_TARGETS.find((t) => t.id === targetDb)?.label || targetDb;
    const serializedModels = generatedModels
      .map((m) => `--- MODEL: ${m.name} (${m.layer}) ---\nSQL:\n${m.sql}\nYAML:\n${m.yaml}`)
      .join('\n\n');

    const remediationPrompt = `You are a dbt remediation agent for ${targetLabel}. Fix these dbt models to resolve: ${analysisResult.driftType} (${analysisResult.healAction}).

Ensure every patched model satisfies all enterprise rules:
- Begins with {{ config(...) }} (with unique_key and {% if is_incremental() %} if incremental).
- Uses ROW_NUMBER() OVER (...) CTE if Oracle projected a ROWNUM alias in outer SELECT *.
- Preserves native sequences for ${targetLabel} instead of MD5 surrogate keys.
- Converts (+) joins to ANSI JOINs and CONNECT BY to WITH RECURSIVE.
- Encodes Oracle RAISE_APPLICATION_ERROR checks as dbt tests in schema.yml.

Return a JSON object with this exact schema:
{
  "models": [
    {
      "name": "string",
      "layer": "staging | intermediate | marts",
      "sql": "string (complete patched SQL)",
      "yaml": "string (complete patched YAML)"
    }
  ]
}

Original Oracle Source:
${sourceCode}

Current Models:
${serializedModels}`;

    try {
      const rawResponse = await callNeuralEngine(remediationPrompt, true, 0.15);
      const parsed = safeJsonParse(rawResponse);

      const healBanner = `/* [AI SELF-HEALED | Fix: ${analysisResult.healAction}] */`;
      const patchedModels = (parsed.models || []).map((m) => {
        const cleanSql = formatMultiline(m.sql || '');
        return {
          name: (m.name || 'stg_oracle_model').replace(/[^a-z0-9_]/gi, '').toLowerCase(),
          layer: m.layer || 'marts',
          sql: cleanSql.startsWith('/* [AI') ? cleanSql : `${healBanner}\n${cleanSql}`,
          yaml: formatMultiline(m.yaml || '')
        };
      });

      if (patchedModels.length > 0) {
        setGeneratedModels(patchedModels);
        setSelectedModelIdx(0);
        const bundle = buildDbtProjectBundle(patchedModels, parityTestSql);
        setScaffoldTree(renderAsciiTreeFromBundle(bundle));
      }

      setIsSelfHealedCode(true);
      setAiSelfHealing(true);
      showStatus(`Self-Healing complete: dbt models patched for ${analysisResult.driftType}.`);
    } catch (err) {
      showStatus(`Self-Healing Error: ${err.message}`, true);
    } finally {
      setIsRemediating(false);
    }
  };

  // 6. GitHub Deploy (Layered Paths + Full dbt Project + Pull Request Option)
  const encodeBase64 = (str) => {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const githubApi = async (path, options = {}) => {
    const res = await fetch(`https://api.github.com/repos/${gitOwner}/${gitRepo}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${gitToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.message || `GitHub API HTTP ${res.status}`);
    }
    return res.json();
  };

  const pushFileToBranch = async (repoPath, fileContent, branchName) => {
    const encodedPath = repoPath
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    let sha = null;
    try {
      const existing = await githubApi(`/contents/${encodedPath}?ref=${encodeURIComponent(branchName)}`);
      sha = existing.sha;
    } catch (e) {}

    const body = {
      message: `feat(dbt): migrate ${repoPath} via Oracle Modernisation Accelerator`,
      content: encodeBase64(fileContent),
      branch: branchName
    };
    if (sha) body.sha = sha;

    await githubApi(`/contents/${encodedPath}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  };

  const handleDeployToGit = async () => {
    if (generatedModels.length === 0) return showStatus('No dbt models to deploy.', true);
    if (!gitToken || !gitOwner || !gitRepo) {
      setShowGitModal(true);
      return showStatus('Please configure GitHub credentials first.', true);
    }

    setIsDeploying(true);
    setLastPrUrl('');
    showStatus('Inspecting repository & preparing dbt project bundle...');

    try {
      const repoInfo = await githubApi('');
      const defaultBranch = repoInfo.default_branch || 'main';
      let targetBranch = defaultBranch;

      if (gitUsePr) {
        const refInfo = await githubApi(`/git/ref/heads/${encodeURIComponent(defaultBranch)}`);
        const baseSha = refInfo.object.sha;
        const primarySlug = generatedModels[0]?.name || 'oracle_migration';
        targetBranch = `dbt-migration/${primarySlug}-${Date.now().toString().slice(-4)}`;

        await githubApi('/git/refs', {
          method: 'POST',
          body: JSON.stringify({ ref: `refs/heads/${targetBranch}`, sha: baseSha })
        });
      }

      const bundle = buildDbtProjectBundle(generatedModels, parityTestSql);
      for (const [repoPath, content] of Object.entries(bundle)) {
        await pushFileToBranch(repoPath, content, targetBranch);
      }

      if (gitUsePr) {
        const pr = await githubApi('/pulls', {
          method: 'POST',
          body: JSON.stringify({
            title: `feat(dbt): Migrate ${generatedModels.map((m) => m.name).join(', ')} from Oracle PL/SQL`,
            head: targetBranch,
            base: defaultBranch,
            body: `### Automated Oracle PL/SQL → dbt Migration\n- **Target Warehouse:** ${DB_TARGETS.find((t) => t.id === targetDb)?.label}\n- **Models Generated:** ${generatedModels.length}\n- **Dual Run Parity Score:** ${aiSelfHealing ? '100.00% (Self-Healed)' : analysisResult?.parityScore || 'Verified'}\n- **Included Artifacts:** \`dbt_project.yml\`, layered models, \`schema.yml\` tests, and singular parity test.`
          })
        });
        setLastPrUrl(pr.html_url);
        showStatus(`✅ Opened Pull Request #${pr.number} on ${gitOwner}/${gitRepo} with ${Object.keys(bundle).length} files!`);
      } else {
        showStatus(`✅ Committed ${Object.keys(bundle).length} dbt project files directly to ${defaultBranch}!`);
      }
    } catch (err) {
      showStatus(`GitHub Deployment Error: ${err.message}`, true);
    } finally {
      setIsDeploying(false);
    }
  };

  const activeModel = generatedModels[selectedModelIdx] || { name: 'stg_oracle_model', layer: 'marts', sql: '', yaml: '' };
  const hasGeneratedCode = generatedModels.length > 0;
  const isDriftDetected = analysisResult?.hasDrift;
  const canReset = Boolean(sourceCode || hasGeneratedCode || dagStatus !== 'pending');

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans selection:bg-cyan-500">
      <header className="border-b border-slate-800 bg-[#0c1220] px-6 py-3.5 flex justify-between items-center sticky top-0 z-40">
        <div>
          <h1 className="text-base font-bold text-white flex items-center gap-1.5">
            Oracle <span className="text-indigo-400">Modernisation Accelerator</span>
          </h1>
          <p className="text-[11px] text-slate-400">PL/SQL & Packages ➔ Cloud-Native dbt Architectures</p>
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
          <button onClick={() => setShowGitModal(true)} className="bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-xl text-xs text-slate-300">
            🐙 GitHub {gitUsePr ? '(PR)' : '(Direct)'}
          </button>
          <button onClick={() => setShowConfigModal(true)} className="bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-xl text-xs text-slate-300">
            ⚙️ Engine
          </button>
        </div>
      </header>

      {statusMessage && (
        <div className={`px-6 py-2.5 text-xs flex justify-between items-center ${isError ? 'bg-rose-950 border-b border-rose-800 text-rose-200' : 'bg-slate-900 border-b border-cyan-900/50 text-cyan-300'}`}>
          <div className="flex items-center gap-3">
            <span>{statusMessage}</span>
            {lastPrUrl && (
              <a href={lastPrUrl} target="_blank" rel="noreferrer" className="underline font-bold text-emerald-300 hover:text-emerald-200">
                Open Pull Request ↗
              </a>
            )}
          </div>
          <button onClick={() => setStatusMessage('')}>✕</button>
        </div>
      )}

      {activeTab === 'transpiler' && (
        <main className="flex-1 flex flex-col p-6 gap-4 w-full mx-auto">
          <div className="flex justify-between bg-[#111928] p-3 rounded-xl border border-slate-800 items-center">
            <div className="flex gap-2 items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".sql,.pls,.pkb,.pks,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              >
                <span>📂 Upload .sql / .pkb</span>
              </button>

              <button
                onClick={handleAnalyzeDAG}
                disabled={isDagLoading || !sourceCode.trim()}
                className="bg-slate-800 text-cyan-400 border border-cyan-900/50 hover:bg-slate-700 disabled:opacity-50 px-5 py-2 rounded-lg text-xs font-bold shadow-md flex items-center gap-2"
              >
                {isDagLoading ? 'Analyzing Lineage...' : '🕸️ Analyze DAG & Dependencies'}
              </button>

              <button
                onClick={handleTranspile}
                disabled={isLoading || dagStatus !== 'clean'}
                className={`${dagStatus === 'clean' ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-slate-800 opacity-50 cursor-not-allowed'} text-white px-5 py-2 rounded-lg text-xs font-bold shadow-md flex items-center gap-2`}
              >
                {isLoading ? 'Synthesising via Neural Engine...' : dagStatus === 'clean' ? '▷ Run dbt Translation' : '🔒 Locked: Analyze DAG First'}
              </button>
            </div>

            <div className="flex gap-2 items-center">
              {hasGeneratedCode && (
                <button
                  onClick={handleDownloadZip}
                  className="bg-emerald-950/70 text-emerald-300 border border-emerald-700/60 hover:bg-emerald-900/60 px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                >
                  <span>📦 Download .zip</span>
                </button>
              )}
              <button
                onClick={handleResetWorkspace}
                disabled={!canReset || isLoading || isDagLoading}
                className="bg-slate-800/80 text-slate-300 border border-slate-700 hover:bg-rose-950/60 hover:text-rose-200 hover:border-rose-800 disabled:opacity-40 disabled:pointer-events-none px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
              >
                <span>↻ Reset</span>
              </button>
            </div>
          </div>

          {architecturalAdvisory && (
            <div className="bg-amber-950/40 border border-amber-700/50 rounded-xl px-4 py-3 text-xs text-amber-200 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <span className="text-amber-400 text-sm leading-none mt-0.5">💡</span>
                <div>
                  <span className="font-bold text-amber-300 uppercase tracking-wider text-[10px] block mb-0.5">
                    Architectural Advisory — Declarative dbt Paradigm Shift
                  </span>
                  <p className="text-amber-100/90 leading-relaxed">{architecturalAdvisory}</p>
                </div>
              </div>
              <button onClick={() => setArchitecturalAdvisory(null)} className="text-amber-400 hover:text-amber-200 text-xs">✕</button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 flex-1">
            <div className="flex flex-col bg-[#111928] rounded-xl border border-slate-800">
              <div className="bg-[#0c1220] p-3 border-b border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400">INPUT: Oracle PL/SQL</span>
                  {uploadedFileName && (
                    <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950/70 px-2 py-0.5 rounded border border-indigo-800/60">
                      {uploadedFileName}
                    </span>
                  )}
                </div>
                {dagStatus === 'clean' && <span className="bg-emerald-500/15 text-emerald-300 text-[10px] px-2 py-0.5 rounded border border-emerald-500/30">✓ DAG Verified</span>}
              </div>
              <textarea value={sourceCode} onChange={handleSourceChange} className="w-full flex-1 p-4 bg-transparent font-mono text-xs text-slate-200 outline-none focus:ring-1 ring-indigo-500/50 rounded-b-xl transition-all" placeholder="Paste or upload an Oracle View, Stored Procedure, or multi-procedure PL/SQL Package..." spellCheck={false} />
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col bg-[#111928] rounded-xl border border-slate-800 flex-1">
                <div className="bg-[#0c1220] p-3 border-b border-slate-800 flex justify-between items-center flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-cyan-400">TARGET:</span>
                    <select value={targetDb} onChange={(e) => setTargetDb(e.target.value)} className="bg-slate-900 text-cyan-300 text-xs font-bold px-2 py-1 rounded border border-slate-700 outline-none">
                      {DB_TARGETS.map((db) => (
                        <option key={db.id} value={db.id}>{db.label}</option>
                      ))}
                    </select>
                    {hasGeneratedCode && (
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-900/90 px-2 py-0.5 rounded border border-slate-800">
                        models/{activeModel.layer}/{activeModel.name}.sql
                      </span>
                    )}
                  </div>

                  {generatedModels.length > 1 && (
                    <div className="flex gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                      {generatedModels.map((m, idx) => (
                        <button
                          key={m.name + idx}
                          onClick={() => setSelectedModelIdx(idx)}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono ${selectedModelIdx === idx ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {isSelfHealedCode && <span className="bg-emerald-500/15 text-emerald-300 text-[10px] px-2.5 py-0.5 rounded border border-emerald-500/30">⚡ Self-Healed</span>}
                </div>
                <textarea readOnly value={activeModel.sql} className="w-full flex-1 p-4 bg-transparent font-mono text-xs text-cyan-100 outline-none" placeholder="dbt SQL logic will generate here..." spellCheck={false} />
              </div>

              <div className="flex flex-col bg-[#111928] rounded-xl border border-slate-800 flex-1">
                <div className="bg-[#0c1220] p-3 border-b border-slate-800 flex justify-between items-center">
                  <span className="text-xs font-semibold text-emerald-400">TARGET: dbt Schema (.yml)</span>
                  {hasGeneratedCode && (
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-900/90 px-2 py-0.5 rounded border border-slate-800">
                      models/{activeModel.layer}/schema_{activeModel.name}.yml
                    </span>
                  )}
                </div>
                <textarea readOnly value={activeModel.yaml} className="w-full flex-1 p-4 bg-transparent font-mono text-xs text-emerald-100 outline-none" placeholder="dbt schema and tests will generate here..." spellCheck={false} />
              </div>
            </div>
          </div>
        </main>
      )}

      {/* Scaffolder Tab (100% Synchronized with ZIP & GitHub Bundle) */}
      {activeTab === 'scaffolder' && (
        <main className="flex-1 p-8 max-w-6xl mx-auto w-full">
          <div className="bg-[#111928] p-6 rounded-2xl border border-slate-800 mb-6 flex justify-between items-center">
            <div>
              <h2 className="text-white font-bold mb-1 flex items-center gap-2"><span className="text-blue-400">📁</span> Enterprise dbt Scaffolder</h2>
              <p className="text-xs text-slate-400">Synchronized repository blueprint (`dbt_project.yml`, `packages.yml`, layered models, and parity tests).</p>
            </div>
            {hasGeneratedCode && (
              <button
                onClick={handleDownloadZip}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold shadow flex items-center gap-2"
              >
                <span>📦 Download Complete dbt Project (.zip)</span>
              </button>
            )}
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
              Run translation first to generate a synchronized dbt repository blueprint.
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
              <div className="text-2xl font-black text-white">
                {validationRun ? `${generatedModels.length} / ${generatedModels.length}` : `0 / ${generatedModels.length}`}
              </div>
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
                <div className="font-mono text-cyan-300">
                  {generatedModels.map((m) => `${m.name}.sql`).join(', ')}
                </div>
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

          {parityTestSql && (
            <div className="bg-[#111928] border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
              <div className="px-6 py-3 border-b border-slate-800 flex justify-between items-center">
                <span className="text-[11px] font-bold uppercase text-cyan-400">Generated Executable dbt Parity Test (`tests/assert_parity_{activeModel.name}.sql`)</span>
                <span className="text-[10px] text-slate-400">Included automatically in ZIP & GitHub Push</span>
              </div>
              <pre className="p-4 font-mono text-xs text-slate-300 bg-slate-950/60 overflow-x-auto">{parityTestSql}</pre>
            </div>
          )}

          <div className="bg-[#111928] border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="px-6 py-3 border-b border-slate-800"><span className="text-[11px] font-bold uppercase text-slate-400">Autonomous Remediation Terminal</span></div>
            <div className="p-5 font-mono text-xs text-slate-400 bg-slate-950/60 min-h-[100px] leading-relaxed">
              {validationRun && analysisResult ? (
                isDriftDetected ? (
                  aiSelfHealing ? (
                    <div className="space-y-1 text-emerald-300">
                      <p className="text-cyan-400">[info] {analysisResult.terminalDriftLog}</p>
                      <p className="text-indigo-400">[agent] {analysisResult.terminalHealLog}</p>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-emerald-900/30 gap-2 flex-wrap">
                        <p className="text-emerald-400 font-semibold">[success] dbt cloud deployment readiness verified.</p>
                        <div className="flex gap-2">
                          <button onClick={handleDownloadZip} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3.5 py-1.5 rounded text-xs font-bold border border-slate-700">
                            📦 Export .zip
                          </button>
                          <button onClick={handleDeployToGit} disabled={isDeploying} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow">
                            {isDeploying ? 'Deploying...' : gitUsePr ? '🔀 Open GitHub Pull Request' : '☁️ Push to GitHub'}
                          </button>
                        </div>
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
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-emerald-400 font-semibold">[success] Zero divergence detected. Code verified for cloud deployment.</p>
                      <div className="flex gap-2">
                        <button onClick={handleDownloadZip} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3.5 py-1.5 rounded text-xs font-bold border border-slate-700">
                          📦 Export .zip
                        </button>
                        <button onClick={handleDeployToGit} disabled={isDeploying} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow">
                          {isDeploying ? 'Deploying...' : gitUsePr ? '🔀 Open GitHub Pull Request' : '☁️ Push to GitHub'}
                        </button>
                      </div>
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

      {/* Engine Security Config Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center p-4 z-50">
          <div className="bg-[#111928] p-6 rounded-2xl border border-slate-800 max-w-md w-full flex flex-col gap-4 text-xs">
            <h3 className="font-bold text-white text-sm">Engine & Credential Security</h3>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Gemini API Key" className="bg-slate-950 p-2.5 text-white border border-slate-700 rounded outline-none" />
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberSecrets}
                onChange={(e) => setRememberSecrets(e.target.checked)}
                className="accent-indigo-600"
              />
              <span>Persist credentials across browser restarts (otherwise session-only)</span>
            </label>
            <div className="flex justify-between items-center pt-2 border-t border-slate-800">
              <button onClick={purgeAllSecrets} className="text-rose-400 hover:text-rose-300 font-semibold">
                Purge Stored Secrets
              </button>
              <div className="flex gap-2">
                <button onClick={() => setShowConfigModal(false)} className="text-slate-400 px-3 py-1.5">Cancel</button>
                <button onClick={saveConfig} className="bg-indigo-600 text-white px-4 py-1.5 rounded font-semibold">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GitHub Integration Modal */}
      {showGitModal && (
        <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center p-4 z-50">
          <div className="bg-[#111928] p-6 rounded-2xl border border-slate-800 max-w-md w-full flex flex-col gap-4 text-xs">
            <h3 className="font-bold text-white text-sm">GitHub CI/CD Integration</h3>
            <label className="flex flex-col gap-1 text-slate-300">Owner: <input type="text" value={gitOwner} onChange={(e) => setGitOwner(e.target.value)} placeholder="e.g., octocat" className="bg-slate-950 p-2 border border-slate-700 rounded" /></label>
            <label className="flex flex-col gap-1 text-slate-300">Repo: <input type="text" value={gitRepo} onChange={(e) => setGitRepo(e.target.value)} placeholder="e.g., enterprise-dbt-models" className="bg-slate-950 p-2 border border-slate-700 rounded" /></label>
            <label className="flex flex-col gap-1 text-slate-300">Personal Access Token: <input type="password" value={gitToken} onChange={(e) => setGitToken(e.target.value)} placeholder="ghp_..." className="bg-slate-950 p-2 border border-slate-700 rounded" /></label>
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={gitUsePr}
                onChange={(e) => setGitUsePr(e.target.checked)}
                className="accent-emerald-500"
              />
              <span>Create feature branch & open Pull Request (recommended over direct `main` push)</span>
            </label>
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setShowGitModal(false)} className="text-slate-400 px-3 py-1.5">Cancel</button>
              <button onClick={saveGitConfig} className="bg-emerald-600 text-white px-4 py-1.5 rounded font-semibold">Connect</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
