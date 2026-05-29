[中文版本](./README_zh.md)

<div align="center">

# Acacia

<strong>Turn your knowledge into a growing tree</strong>
<img src="./doc/tree_growth.gif" width="600" alt="demo" />

</div>

## Features

- 🌲 **Knowledge tree visualization** - reflects your knowledge style and grows with you.

![tree_growing](./doc/home.png)

- 🗣️ **AI chat** — deep questioning and guidance around knowledge points, making it easier to harvest notes and insights.

![talking](./doc/talking.png)

- Basic knowledge management features.


## Running

- **Online version**: [acacia.tandyblow.top](https://acacia.tandyblow.top)
- **Local run**: `bash dev.sh`
- **Docker**: `docker compose up`

## How are styles generated...?

Use LLM to generate a prompt based on your knowledge data first, then use GPT-image-2 to edit a basic background with that prompt.

## Future work

This project has done half planned works now.
Next step:
- **AI chat optimization**: improve the generation quality of knowledge points and notes, and optimize the conversation flow.
- **UX optimization**: improve page navigation logic and animations, add more convenient and intuitive interaction methods.
- **Review feature improvement**: remove the "Today's Growth" module, enable each knowledge point to grow on its own, and allow AI to insert a question after any note at any time.
- **Growth system optimization**: the current growth structure is relatively rigid and lacks diversity.
- **Introduce management elements**: add management elements to the main page tree system.

## Thanks to...

- [proctree.js](https://github.com/supereggbert/proctree.js) for toon leaves
- [EZ-Tree](https://github.com/dgreenheck/ez-tree) for tree structures
- [LINUX.DO](https://linux.do)
