import { ExternalLink } from "lucide-react";

const JIRA_BASE = "https://avalara.atlassian.net/browse";
const JIRA_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

export default function JiraLink({ jKey, className = "" }) {
  const key = (jKey || "").trim();
  if (!key) return null;
  if (!JIRA_KEY_RE.test(key)) {
    return <span className={className}>{key}</span>;
  }
  return (
    <a
      href={`${JIRA_BASE}/${key}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 hover:underline ${className}`}
      title={`Open ${key} in Jira`}
    >
      <span className="font-mono">{key}</span>
      <ExternalLink className="h-3 w-3 opacity-70" />
    </a>
  );
}
