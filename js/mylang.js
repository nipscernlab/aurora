monaco.languages.register({ id: 'CMM' }); 

monaco.languages.setMonarchTokensProvider('CMM', {
  tokenizer: {
    root: [
      // Palavras-chave
      [/\b(if|else|for|while|return|int|float|void|usemacro)\b/, 'keyword'],

      // Identificadores
      [/[a-zA-Z_]\w*/, 'identifier'],

      // Operadores
      [/[<>!~?&|+\-*/%=]/, 'operator'],

      // Números
      [/\b\d+(\.\d+)?\b/, 'number'],

      // Strings
      [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
    ],
    string: [
      [/[^\\"]+/, 'string'],
      [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
    ],
  },
});

monaco.editor.defineTheme('CMMTheme', {
  base: 'vs-dark', // Tema base
  inherit: true,
  rules: [
    { token: 'keyword', foreground: 'ff9900', fontStyle: 'bold' },
    { token: 'identifier', foreground: 'ffffff' },
    { token: 'operator', foreground: 'cccccc' },
    { token: 'number', foreground: '6A8759' },
    { token: 'string', foreground: '
