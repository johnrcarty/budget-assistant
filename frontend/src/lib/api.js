const tokenKey = `budgetassistant.token:${location.pathname}`;
let savedToken = localStorage.getItem(tokenKey);
export async function api(path, options = {}) {
  const mutation = !["GET", "HEAD"].includes(
    (options.method || "GET").toUpperCase(),
  );
  function failure(message, unknown = false) {
    const error = new Error(message);
    error.outcomeUnknown = mutation && unknown;
    return error;
  }
  const headers = {
    "Content-Type": "application/json",
    ...(savedToken ? { Authorization: `Bearer ${savedToken}` } : {}),
  };
  let response;
  try {
    response = await fetch(new URL(`api/${path}`, document.baseURI), {
      credentials: "same-origin",
      ...options,
      headers: { ...headers, ...options.headers },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw failure(
      "Could not reach BudgetAssistant. Check that the server is running.",
      true,
    );
  }
  if (response.status === 204) return null;
  let result;
  try {
    result = await response.json();
  } catch {
    throw failure(
      "The server returned an unexpected response.",
      !(response.status >= 400 && response.status < 500),
    );
  }
  if (!response.ok) {
    const detail = result.detail;
    throw failure(
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((x) => x.msg).join("; ")
          : result.error || "Something went wrong. Please try again.",
      response.status >= 500,
    );
  }
  return result;
}

export const getToken = () => savedToken;
export function setToken(token) {
  savedToken = token;
  if (token) localStorage.setItem(tokenKey, token);
  else localStorage.removeItem(tokenKey);
}
