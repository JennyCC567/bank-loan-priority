const state = {
  model: null,
  customers: [],
  ranked: [],
};

const numericColumns = new Set(["Age", "Income", "Family", "CCAvg", "Education", "Mortgage"]);

const els = {
  rows: document.getElementById("customerRows"),
  rowCount: document.getElementById("rowCount"),
  search: document.getElementById("searchBox"),
  segment: document.getElementById("segmentFilter"),
  download: document.getElementById("downloadBtn"),
  form: document.getElementById("predictForm"),
  manualProbability: document.getElementById("manualProbability"),
  manualAdvice: document.getElementById("manualAdvice"),
  checkStatus: document.getElementById("checkStatus"),
  topAcceptedMetric: document.getElementById("topAcceptedMetric"),
  randomMetric: document.getElementById("randomMetric"),
  liftMetric: document.getElementById("liftMetric"),
};

function parseCsv(text) {
  const rows = [];
  let current = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      current.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      current.push(value);
      if (current.some((item) => item !== "")) rows.push(current);
      current = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || current.length) {
    current.push(value);
    rows.push(current);
  }

  const [headers, ...body] = rows;
  return body.map((row) => Object.fromEntries(headers.map((header, index) => {
    const raw = row[index] ?? "";
    const valueAsNumber = Number(raw);
    return [header, raw !== "" && Number.isFinite(valueAsNumber) ? valueAsNumber : raw];
  })));
}

function sigmoid(x) {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function activate(values, activation) {
  if (activation === "relu") return values.map((value) => Math.max(0, value));
  if (activation === "sigmoid") return values.map(sigmoid);
  return values;
}

function predictProbability(input) {
  const vector = state.model.inputs.map((name) => {
    const value = Number(input[name]);
    const scaling = state.model.scaling[name];
    if (scaling) return (value - scaling.mean) / scaling.std;
    return value;
  });

  let activations = vector;
  for (const layer of state.model.layers) {
    const output = layer.bias.map((bias, neuronIndex) => (
      activations.reduce((sum, value, inputIndex) => (
        sum + value * layer.weights[inputIndex][neuronIndex]
      ), bias)
    ));
    activations = activate(output, layer.activation);
  }

  return activations[0];
}

function formatPercent(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function educationLabel(value) {
  if (Number(value) === 1) return "Undergrad";
  if (Number(value) === 2) return "Graduate";
  if (Number(value) === 3) return "Advanced";
  return String(value);
}

function getFilteredRows() {
  const search = els.search.value.trim().toLowerCase();
  const segment = els.segment.value;

  return state.ranked.filter((row) => {
    const matchesSearch = !search || String(row.ID).toLowerCase().includes(search);
    if (!matchesSearch) return false;
    if (segment === "top100") return row.rank <= 100;
    if (segment === "accepted") return row.accepted_loan === 1;
    if (segment === "high") return row.p_browser >= 0.5;
    return true;
  });
}

function renderTable() {
  const rows = getFilteredRows();
  els.rowCount.textContent = `${rows.length} rows`;
  els.rows.innerHTML = rows.slice(0, 250).map((row) => `
    <tr>
      <td>${row.rank}</td>
      <td>${row.ID}</td>
      <td class="probability-cell">${formatPercent(row.p_browser, 2)}</td>
      <td class="${row.accepted_loan ? "accepted" : "not-accepted"}">${row.accepted_loan ? "Yes" : "No"}</td>
      <td>$${Number(row.Income).toLocaleString()}k</td>
      <td>${educationLabel(row.Education)}</td>
      <td>$${Number(row.CCAvg).toFixed(1)}k</td>
      <td>${row.Family}</td>
    </tr>
  `).join("");
}

function updateMetrics() {
  const top100 = state.ranked.slice(0, 100);
  const acceptedTop100 = top100.reduce((sum, row) => sum + Number(row.accepted_loan), 0);
  const randomAccepted = Math.round(100 * state.ranked.reduce((sum, row) => sum + Number(row.accepted_loan), 0) / state.ranked.length);
  const lift = acceptedTop100 / randomAccepted;

  els.topAcceptedMetric.textContent = `${acceptedTop100}/100`;
  els.randomMetric.textContent = `${randomAccepted}/100`;
  els.liftMetric.textContent = `${lift.toFixed(1)}x`;
}

function runConsistencyCheck() {
  const diffs = state.customers.map((row) => Math.abs(row.p_browser - row.p_nn_reference));
  const maxDiff = Math.max(...diffs);
  const passed = maxDiff < 0.00001;

  els.checkStatus.textContent = `${passed ? "Passed" : "Failed"}: max difference ${maxDiff.toExponential(3)}`;
  els.checkStatus.className = `check-status ${passed ? "pass" : "fail"}`;
}

function readFormCustomer() {
  const formData = new FormData(els.form);
  const customer = {};
  for (const name of state.model.inputs) {
    customer[name] = Number(formData.get(name));
  }
  return customer;
}

function handlePrediction(event) {
  event.preventDefault();
  const customer = readFormCustomer();
  const probability = predictProbability(customer);
  els.manualProbability.textContent = formatPercent(probability, 2);
  els.manualAdvice.textContent = probability >= 0.5
    ? "High priority for the calling team."
    : "Lower priority than the strongest customers in the ranked list.";
}

function csvEscape(value) {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function downloadCallList() {
  const headers = ["rank", "ID", "probability", "accepted_loan", ...state.model.inputs];
  const rows = state.ranked.slice(0, 100).map((row) => [
    row.rank,
    row.ID,
    row.p_browser,
    row.accepted_loan,
    ...state.model.inputs.map((name) => row[name]),
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "bank-loan-top-100-call-list.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function init() {
  const [modelResponse, customerResponse] = await Promise.all([
    fetch("model_nn.json"),
    fetch("customers_test.csv"),
  ]);

  state.model = await modelResponse.json();
  state.customers = parseCsv(await customerResponse.text()).map((row) => {
    const typed = { ...row };
    for (const key of Object.keys(typed)) {
      if (numericColumns.has(key) || ["ID", "accepted_loan", "p_nn_reference"].includes(key)) {
        typed[key] = Number(typed[key]);
      }
    }
    typed.p_browser = predictProbability(typed);
    return typed;
  });

  state.ranked = [...state.customers]
    .sort((a, b) => b.p_browser - a.p_browser)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  updateMetrics();
  renderTable();
  runConsistencyCheck();
  handlePrediction(new Event("submit"));
}

els.search.addEventListener("input", renderTable);
els.segment.addEventListener("change", renderTable);
els.form.addEventListener("submit", handlePrediction);
els.download.addEventListener("click", downloadCallList);

init().catch((error) => {
  console.error(error);
  els.checkStatus.textContent = "Could not load model files";
  els.checkStatus.className = "check-status fail";
});
