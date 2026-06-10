import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw } from "lucide-react";
import InfoTip from "@/components/InfoTip";

const AGENT_ID = "4c8533e8373b41edbde22d6f5793d4d4";
const POLL_MAX_MS = 8000;
const POLL_INTERVAL_MS = 200;

export default function GleanAgent({ onCsvDetected }) {
  const containerRef = useRef(null);
  const mountedRef = useRef(false);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    const start = Date.now();

    const tryMount = () => {
      if (cancelled || mountedRef.current) return;
      const sdk = window.GleanWebSDK;
      if (sdk && typeof sdk.renderChat === "function" && containerRef.current) {
        try {
          sdk.renderChat(containerRef.current, { agentId: AGENT_ID });
          mountedRef.current = true;
          setStatus("ready");
        } catch (err) {
          console.error("Glean renderChat failed", err);
          setStatus("error");
        }
        return;
      }
      if (Date.now() - start > POLL_MAX_MS) {
        setStatus("timeout");
        return;
      }
      setTimeout(tryMount, POLL_INTERVAL_MS);
    };
    tryMount();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid gap-4">
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold">
              Live Jira Pull via Glean Agent
              <InfoTip title="How this works" side="right">
                The embedded Glean agent runs against Avalara Jira via your active Glean session.
                Ask it to export the M&amp;A hierarchy as CSV, copy the result,
                then switch to <b>Overview</b> and paste into the <b>Paste CSV</b> tab to load the dashboard.
              </InfoTip>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="https://app.glean.com/chat"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline"
              >
                Open in Glean <ExternalLink className="h-3 w-3" />
              </a>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.location.reload()}
                className="h-7 gap-1 text-xs"
              >
                <RefreshCw className="h-3 w-3" /> Reload
              </Button>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Suggested prompt: <i>"Export SBR-356 with all child Initiatives, Roadmap Items, Epics, Stories, Sub-tasks and linked issues as CSV using the dashboard's column schema."</i>
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <div
            ref={containerRef}
            id="glean-app"
            style={{ position: "relative", display: "block", height: "70vh", width: "100%" }}
          />
          {status !== "ready" && (
            <div className="px-4 py-3 text-xs text-slate-500">
              {status === "loading" && "Loading Glean agent…"}
              {status === "timeout" &&
                "Glean SDK did not load in time. Check that you're signed in to Glean Avalara and that the embedded-search script isn't blocked."}
              {status === "error" &&
                "Glean SDK loaded but the agent failed to render. Try Reload, or open the agent directly in a Glean tab."}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
