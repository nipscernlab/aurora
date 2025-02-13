# Aurora IDE

<div align="center">
  <img src="https://github.com/nipscernlab/Aurora/blob/main/assets/icons/aurora_borealis-2.ico" alt="Aurora Logo" width="200"/>
</div>

## About

Aurora IDE is the official integrated development environment for SAPHO (Scalable Architecture Processor for Hardware Optimization) projects. Built with Electron, it provides a modern, feature-rich environment for processor design and implementation.

## Key Features

### Core Functionality
- Create and manage .spf projects
- Design and implement custom processors
- Implement algorithms (e.g., FFT, DTW)
- One-click compilation and simulation
- Integrated GTKWave visualization

### Development Environment
- Modern Monaco Editor
- File tree navigation
- Multiple dark/light themes
- Five specialized terminals:
  - TCMM: CMM compilation
  - TASM: Assembly compilation
  - TIVERI: Verilog processing
  - TWAVE: Waveform visualization
  - TCMD: Command terminal

### Advanced Features
- GitHub integration
- ChatGPT and Claude AI assistance
- Line-by-line debugging
- Automated project backup (7z compression)
- Integrated bug reporting
- Direct access to nipscern.com

## Prerequisites

- Node.js
- Electron
- Git
- SAPHO Compilers suite
- GTKWave
- 7-Zip

## Installation

1. Clone the repository:
```bash
git clone https://github.com/nipscernlab/Aurora.git
cd Aurora
```

2. Install dependencies:
```bash
npm install
```

3. Launch Aurora:
```bash
npm start
```

## Project Structure

```
Project_Name.spf/
├── Processors/
│   └── ProcessorName/
│       ├── Hardware/
│       ├── Software/
│       └── Simulation/
├── Implementations/
│   ├── FFT/
│   └── DTW/
└── Backup/
    └── [Compressed project backups]
```

## Usage Guide

### Creating a New Project
1. Click "New Project" and select .spf format
2. Configure project settings
3. Set up processor specifications

### Development Workflow
1. Write your implementation in the Monaco editor
2. Use the file tree to navigate project files
3. Configure compilation settings
4. Click "Build & Run" for one-click compilation
5. View simulation results in integrated GTKWave

### Using AI Assistance
- Access ChatGPT or Claude directly from the IDE
- Get help with code implementation
- Debug assistance
- Best practices suggestions

### Backup and Version Control
- Automatic project backup with 7z
- Direct GitHub integration for version control
- Push/pull directly from the IDE

## Contact

For questions and support, contact us at:
- Website: [nipscern.com](https://nipscern.com)
- Email: nipscern@contac.com

## Contributing

Contributions are welcome! To contribute:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Bug Reporting

Use the integrated bug reporting feature in Aurora IDE or create an issue on GitHub with:
- Bug description
- Steps to reproduce
- Expected behavior
- Screenshots (if applicable)
- System information

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- NIPSCERN Lab
- Federal University of Juiz de Fora (UFJF)
- Monaco Editor team
- Electron community
- All contributors to this project

---

Made with ❤️ by NIPSCERN Lab
