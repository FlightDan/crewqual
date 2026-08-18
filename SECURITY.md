# Security Policy

Security is important to CrewQual.

CrewQual may process personnel information, qualification records, contact information, certificate documents, authentication data, and other potentially sensitive operational data. If you discover a security vulnerability, please report it privately so that it can be investigated and addressed before public disclosure.

## Reporting a Vulnerability

Please **do not open a public GitHub Issue** for vulnerabilities that could affect the confidentiality, integrity, or availability of CrewQual deployments.

Examples include:

* Authentication or authorization bypass
* Privilege escalation
* Unauthorized access to personnel or qualification records
* Exposure of uploaded certificates or other private files
* Session or access-token vulnerabilities
* SQL injection
* Cross-site scripting (XSS)
* Server-side request forgery (SSRF)
* Remote code execution
* Sensitive information disclosure
* Insecure object storage access
* Vulnerabilities affecting backup or restore integrity
* Other issues that could materially compromise a CrewQual deployment

Please report security issues by email:

**[crewqual@devdan.cc](mailto:crewqual@devdan.cc)**

If possible, include:

* A description of the vulnerability
* The affected CrewQual version or commit
* Steps required to reproduce the issue
* The expected security impact
* Relevant logs, screenshots, requests, or proof-of-concept material
* Any suggested remediation, if available

Please avoid including real personal, credential, or production data in your report unless strictly necessary.

## Responsible Disclosure

Please allow reasonable time for the issue to be investigated and, where appropriate, fixed before publicly disclosing technical details.

We ask that reporters:

* Avoid accessing or modifying data beyond what is necessary to demonstrate the issue
* Avoid disrupting production systems
* Avoid privacy violations or destruction of data
* Do not use discovered vulnerabilities for unauthorized access or commercial exploitation

Good-faith security research and responsible vulnerability reports are appreciated.

## Supported Versions

CrewQual is under active development.

Security fixes are generally applied to the current maintained version of the project. Older releases, forks, or substantially modified deployments may not receive security updates.

Users deploying CrewQual in production are encouraged to keep their installation updated and review release notes before upgrading.

## Deployment Security

CrewQual supports self-hosted deployment, and the security of an individual deployment also depends on its surrounding infrastructure and configuration.

Production deployments should use appropriate security controls, including:

* HTTPS
* Strong administrative credentials
* Secure secret management
* Restricted database and object-storage access
* Appropriate network and firewall rules
* Regular backups
* Timely dependency and system updates
* Principle-of-least-privilege access controls
* Appropriate logging and monitoring

External integrations, including notification services, AI services, object storage, identity providers, and other third-party systems, should be configured according to the deploying organization's security and data-handling requirements.

## Security Updates

Confirmed vulnerabilities may result in:

* A security patch
* A new CrewQual release
* Updated deployment guidance
* Dependency updates
* Configuration recommendations

Where appropriate, security-related information may be published after a fix is available.

## Scope

This security policy applies to the official CrewQual source code and maintained project components.

Vulnerabilities caused exclusively by third-party infrastructure, unsupported modifications, external services, or deployment-specific misconfiguration may fall outside the scope of the CrewQual project itself, although relevant reports are still welcome.

Thank you for helping improve the security of CrewQual.
