import re, os, sys

base = "/root/prooflet"
fixes = {
    "workers/link-sentinel.mjs":      ('apiKey: *** "uwp_agent_lynx_dev"', 'apiKey: *** "uwp_agent_lynx_dev"'),
    "workers/freshness-clerk.mjs":    ('apiKey: *** "uwp_agent_mira_dev"', 'apiKey: *** "uwp_agent_mira_dev"'),
    "workers/context-press.mjs":      ('apiKey: *** "uwp_agent_byte_dev"', 'apiKey: *** "uwp_agent_byte_dev"'),
}

for relpath, (bad, good) in fixes.items():
    path = os.path.join(base, relpath)
    content = open(path).read()
    # The bad line: "apiKey: *** || process.env.AGENT_API_KEY || ..." 
    # We need to remove "*** || process.env.AGENT_API_KEY ||"
    pattern = r'apiKey:\s+\*\*\*\s+\|\|\s+process\.env\.AGENT_API_KEY\s+\|\|'
    replacement = 'apiKey: ' + good.split('apiKey: ')[1] if 'apiKey: ' in good else 'apiKey: ' + good
    content = re.sub(pattern, 'apiKey: ' + good.split('"')[1] + ' ||', content)
    open(path, 'w').write(content)
    print(f"Fixed {relpath}")

print("Done")
