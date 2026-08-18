# Contributing to CrewQual

Thank you for considering contributing to CrewQual.

CrewQual welcomes code contributions, documentation improvements, bug reports, feature requests, UI/UX improvements, and feedback from real-world qualification and compliance management workflows.

## Reporting Issues

Before opening a new issue, please search the existing issues to check whether the same or a similar problem has already been reported.

When reporting a bug, please include as much of the following information as possible:

* A clear description of the problem
* Steps to reproduce the issue
* Expected behavior
* Actual behavior
* CrewQual version or commit
* Deployment environment
* Relevant logs, screenshots, or error messages

For feature requests, please describe the underlying use case and the problem you are trying to solve, rather than only proposing a specific implementation.

## Pull Requests

Bug fixes, small improvements, and documentation changes may be submitted directly as pull requests.

For larger features, database model changes, architectural changes, or modifications that may significantly affect existing workflows, please open an issue first to discuss the proposed design and scope.

Whenever possible, each pull request should:

* Focus on one clearly defined problem or feature
* Avoid unrelated refactoring or formatting changes
* Follow the existing project structure and coding style
* Include appropriate tests for new or changed behavior
* Update relevant documentation when behavior changes
* Pass the existing type checks, tests, and build process

## Local Development

Please refer to the Quick Start and deployment documentation in the project README for instructions on setting up a local development environment.

Using the provided Docker Compose environment is recommended where possible to keep the database, object storage, and other dependencies consistent with the expected development environment.

## Commits and Code Style

Commit messages should be concise and describe the purpose of the change.

Examples:

```text
fix: correct qualification expiry calculation
feat: add configurable reminder rules
docs: update deployment guide
```

CrewQual does not currently require strict adherence to a specific commit convention, but please avoid vague commit messages such as:

```text
update
fix
test
123
```

Before submitting a pull request, please run the formatting, type-checking, testing, and build commands provided by the project.

## Database Changes

If your contribution modifies the database schema:

* Use the project's existing migration mechanism
* Do not rely on manual production database changes
* Consider compatibility with existing data
* Provide a reasonable migration path where necessary
* Clearly document destructive or potentially breaking migrations in the pull request

## Security Issues

If you discover a vulnerability that could result in unauthorized access, sensitive-data disclosure, privilege escalation, authentication bypass, or another security issue, please do not disclose full exploitation details in a public issue.

Instead, report the vulnerability using the security contact or reporting process described in [`SECURITY.md`](./SECURITY.md).

## Contributor License Agreement

Before a contribution can be merged into CrewQual, contributors must accept the project's [Contributor License Agreement](./CLA.md).

Contributors retain ownership of their Contributions while granting CrewQual the rights described in the CLA, including the permissions required to use, distribute, and relicense those Contributions.

Contributions may only be merged after the applicable CLA acceptance process has been completed.

## Third-Party Code and Materials

Do not submit code, images, documentation, data, or other third-party materials unless you have the right to contribute them under terms compatible with CrewQual.

If a contribution includes third-party material, please clearly identify:

* Its source
* Its original author or copyright holder
* Its applicable license
* Any restrictions that may affect its use or redistribution

## Acceptance of Contributions

Submitting a contribution does not guarantee that it will be merged.

Maintainers may request changes or decline a contribution for reasons including:

* It falls outside the current scope of the project
* It introduces unnecessary complexity
* It conflicts with the existing architecture or business model
* It lacks sufficient tests or documentation
* It creates compatibility, security, or long-term maintenance concerns

For substantial design disagreements, discussion through an issue is generally preferred before investing significant effort in implementation.

## Community Conduct

Please keep technical and product discussions professional, respectful, and focused on the subject being discussed.

Qualification, training, and compliance workflows can differ significantly between organizations and industries. Alternative approaches are welcome, but please provide relevant operational context, constraints, and design trade-offs where possible.

Thank you for contributing to CrewQual.
