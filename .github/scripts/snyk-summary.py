"""Summarise Snyk results for the Security workflow.

Reads the dependency scan (`snyk test --json-file-output`) and the code scan
(`snyk code test --sarif-file-output`), writes a shields.io endpoint badge and
a job summary, and exits non-zero when the repo is not clean.

Counted as vulnerabilities: every open dependency issue, plus Snyk Code
findings at high or medium. Low code findings are listed in the summary but
don't fail the job: they are hardcoded values in *.spec.ts test fixtures.

Usage: snyk-summary.py DEPS_JSON CODE_SARIF DEPS_EXIT CODE_EXIT BADGE_OUT
"""
import json
import os
import sys

deps_path, code_path, deps_exit, code_exit, badge_out = sys.argv[1:6]
deps_exit, code_exit = int(deps_exit), int(code_exit)

# Snyk exit codes: 0 clean, 1 issues found, 2 error, 3 nothing to test.
scan_error = deps_exit not in (0, 1) or code_exit not in (0, 1)

# One entry per (lockfile, issue id, severity); the details are those of the
# first path Snyk reports for it.
dependency_issues = {}
if os.path.exists(deps_path):
    with open(deps_path) as fh:
        projects = json.load(fh)
    for project in projects if isinstance(projects, list) else [projects]:
        for vuln in project.get('vulnerabilities', []):
            key = (project.get('displayTargetFile'), vuln['id'], vuln['severity'])
            dependency_issues.setdefault(key, vuln)

code_levels = {'error': 0, 'warning': 0, 'note': 0}
code_rules = {}
code_serious = []
if os.path.exists(code_path):
    with open(code_path) as fh:
        sarif = json.load(fh)
    for run in sarif.get('runs', []):
        for result in run.get('results', []):
            if result.get('suppressions'):
                continue
            level = result.get('level', 'note')
            code_levels[level] = code_levels.get(level, 0) + 1
            rule = result.get('ruleId', 'unknown')
            code_rules[rule] = code_rules.get(rule, 0) + 1
            if level in ('error', 'warning'):
                location = ((result.get('locations') or [{}])[0].get('physicalLocation') or {})
                code_serious.append((
                    'high' if level == 'error' else 'medium',
                    rule,
                    (location.get('artifactLocation') or {}).get('uri', '?'),
                    (location.get('region') or {}).get('startLine', '?'),
                ))

by_severity = {}
for _, _, severity in dependency_issues:
    by_severity[severity] = by_severity.get(severity, 0) + 1
code_high, code_medium, code_low = code_levels['error'], code_levels['warning'], code_levels['note']
total = len(dependency_issues) + code_high + code_medium

if scan_error:
    badge = {'message': 'scan error', 'color': 'lightgrey'}
elif total == 0:
    badge = {'message': '0', 'color': 'brightgreen'}
else:
    worst_high = by_severity.get('critical', 0) + by_severity.get('high', 0) + code_high
    badge = {'message': str(total), 'color': 'red' if worst_high else 'orange'}

with open(badge_out, 'w') as fh:
    json.dump({'schemaVersion': 1, 'label': 'vulnerabilities', **badge}, fh)

summary = [
    '## Snyk',
    '',
    '| Scan | Result |',
    '| --- | --- |',
    f"| Dependencies | {len(dependency_issues)} open"
    + (f" ({', '.join(f'{n} {s}' for s, n in sorted(by_severity.items()))})" if by_severity else '')
    + f' (snyk test exit {deps_exit}) |',
    f'| Code | {code_high} high, {code_medium} medium, {code_low} low (snyk code exit {code_exit}) |',
    '',
    f"Badge: **vulnerabilities: {badge['message']}**",
]


def cell(value):
    """A value that cannot break a Markdown table row."""
    return str(value).replace('|', '\\|').replace('\n', ' ')


# Which issues are open: without this the counts above cannot be acted on.
SEVERITY_ORDER = ['critical', 'high', 'medium', 'low']
if dependency_issues:
    summary += [
        '',
        '### Open dependency issues',
        '',
        '| Severity | Package | Issue | Fixed in | Reached through | Lockfile |',
        '| --- | --- | --- | --- | --- | --- |',
    ]
    ordered = sorted(
        dependency_issues.items(),
        key=lambda item: (
            SEVERITY_ORDER.index(item[0][2]) if item[0][2] in SEVERITY_ORDER else len(SEVERITY_ORDER),
            item[1].get('packageName') or item[1].get('name') or '',
            item[0][1],
        ),
    )
    for (target, issue_id, severity), vuln in ordered:
        package = vuln.get('packageName') or vuln.get('name') or '?'
        path = vuln.get('from') or []
        # from[0] is the project itself; the next entry is our direct dependency.
        through = path[1] if len(path) > 2 else 'direct dependency' if len(path) == 2 else '?'
        fixed = ', '.join(vuln.get('fixedIn') or []) or 'no fixed version'
        summary.append(
            f"| {cell(severity)} | {cell(package)}@{cell(vuln.get('version', '?'))} "
            f"| {cell(issue_id)}: {cell(vuln.get('title', ''))} | {cell(fixed)} | {cell(through)} | {cell(target)} |"
        )
if code_rules:
    summary += ['', '### Code findings by rule', '', '| Rule | Findings |', '| --- | --- |']
    summary += [f'| {cell(rule)} | {count} |' for rule, count in sorted(code_rules.items(), key=lambda item: (-item[1], item[0]))]
if code_serious:
    summary += ['', '### Code findings at high or medium', '', '| Severity | Rule | Where |', '| --- | --- | --- |']
    summary += [f'| {severity} | {cell(rule)} | {cell(uri)}:{line} |' for severity, rule, uri, line in sorted(code_serious)]
if os.environ.get('GITHUB_STEP_SUMMARY'):
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as fh:
        fh.write('\n'.join(summary) + '\n')
print('\n'.join(summary))

sys.exit(1 if scan_error or total else 0)
