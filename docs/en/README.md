# Technical docs

[简体中文](../zh-CN/README.md) · [Project home](../../README.en.md) · [Wiki](../../wiki/README.md)

Start with installation for a new deployment. Use the Wiki for everyday workflows and the development guide before changing code.

| Page                                      | Coverage                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| [Installation and setup](installation.md) | Linux, Windows with WSL2, network modes, first setup                   |
| [Configuration](configuration.md)         | Environment variables, database, object storage, notifications, and AI |
| [Operations](operations.md)               | Health checks, updates, backups, and recovery                          |
| [Development](development.md)             | Local previews, development with real services, tests, and builds      |
| [Architecture](architecture.md)           | Code layout, service boundaries, data flow, and language support       |

## Maintaining these docs

Chinese and English pages use matching filenames and link to each other at the top. Update both languages when changing commands, settings, or business rules. Commands should work in the environment the page specifies. State the prerequisites and effects of operations that change data.

Check the code before writing instructions. Keep the terms used in the interface and explain concrete actions and results without sales language. Document a feature's workflow once it exists; keep unimplemented plans in the roadmap.
