export function requestFailureMessage(error, method = "get") {
  if (error?.code === "ERR_CANCELED") return "";
  if (error?.response) return "";
  const read = ["get", "head", "options"].includes(String(method).toLowerCase());
  const timeout = ["ECONNABORTED", "ETIMEDOUT"].includes(error?.code);
  return read ? timeout ? "The request timed out. Please try refreshing." : "Unable to reach the server. Check your connection and refresh."
    : "The server response was not received. This action may already have completed. Refresh its status before trying again.";
}
