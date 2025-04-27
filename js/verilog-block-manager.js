// verilog-block-manager.js
/**
 * Gerenciador de Blocos Verilog
 * 
 * Este módulo implementa a funcionalidade do modal de inserção de blocos Verilog
 * para o editor Monaco em um projeto Electron.
 * 
 * Responsabilidades:
 * - Gerenciar o modal de seleção de blocos Verilog
 * - Filtrar blocos por categoria e pesquisa
 * - Inserir o código selecionado no editor
 * - Verificar compatibilidade do arquivo atual
 */
const VerilogBlockManager = (() => {
  // Elementos do DOM
  let modal;
  let blockSearch;
  let clearSearchBtn;
  let closeModalBtn;
  let categoriesList;
  let blocksList;
  let selectedBlockName;
  let insertBlockBtn;
  
  // Armazenamento de dados
  let blocks = [];
  let selectedBlock = null;
  let categories = ['All', 'Communication', 'Computation', 'Memory', 'Timing', 'Utility'];
  let activeCategory = 'All';
  
  // Definição dos blocos Verilog disponíveis
  const verilogBlocks = [
    {
      name: 'button_debounce.v',
      category: 'Timing',
      description: 'Timing-based button debouncing circuit',
      code: `module button_debounce(
  input wire clk,
  input wire reset,
  input wire button_in,
  output reg button_out
);
  // Parameters
  parameter DEBOUNCE_DELAY = 1000000; // Clock cycles to wait
  
  // Internal registers
  reg [31:0] counter = 0;
  reg button_state = 0;
  
  always @(posedge clk or posedge reset) begin
    if (reset) begin
      counter <= 0;
      button_state <= 0;
      button_out <= 0;
    end else begin
      if (button_in != button_state) begin
        if (counter == DEBOUNCE_DELAY) begin
          button_state <= button_in;
          button_out <= button_in;
          counter <= 0;
        end else begin
          counter <= counter + 1;
        end
      end else begin
        counter <= 0;
      end
    end
  end
endmodule`
    },
    {
      name: 'pipeline_registers.v',
      category: 'Utility',
      description: 'A parameterized number of pipeline registers of some depth and width',
      code: `module pipeline_registers #(
  parameter WIDTH = 32,
  parameter DEPTH = 1
)(
  input wire clk,
  input wire reset,
  input wire [WIDTH-1:0] in,
  output wire [WIDTH-1:0] out
);
  
  // Generate pipeline registers
  genvar i;
  wire [WIDTH-1:0] pipe [DEPTH:0];
  
  assign pipe[0] = in;
  assign out = pipe[DEPTH];
  
  generate
    for (i = 0; i < DEPTH; i = i + 1) begin : pipe_stage
      reg [WIDTH-1:0] pipe_reg;
      
      always @(posedge clk or posedge reset) begin
        if (reset) begin
          pipe_reg <= {WIDTH{1'b0}};
        end else begin
          pipe_reg <= pipe[i];
        end
      end
      
      assign pipe[i+1] = pipe_reg;
    end
  endgenerate
endmodule`
    },
    {
      name: 'pipeline_registers_set.v',
      category: 'Utility',
      description: 'Pipeline registers with the ability to set the value of the registers',
      code: `module pipeline_registers_set #(
  parameter WIDTH = 32,
  parameter DEPTH = 1
)(
  input wire clk,
  input wire reset,
  input wire set_enable,
  input wire [WIDTH-1:0] set_value,
  input wire [WIDTH-1:0] in,
  output wire [WIDTH-1:0] out
);
  
  // Generate pipeline registers
  genvar i;
  wire [WIDTH-1:0] pipe [DEPTH:0];
  
  assign pipe[0] = in;
  assign out = pipe[DEPTH];
  
  generate
    for (i = 0; i < DEPTH; i = i + 1) begin : pipe_stage
      reg [WIDTH-1:0] pipe_reg;
      
      always @(posedge clk or posedge reset) begin
        if (reset) begin
          pipe_reg <= {WIDTH{1'b0}};
        end else if (set_enable) begin
          pipe_reg <= set_value;
        end else begin
          pipe_reg <= pipe[i];
        end
      end
      
      assign pipe[i+1] = pipe_reg;
    end
  endgenerate
endmodule`
    },
    {
      name: 'ram_infer.v',
      category: 'Memory',
      description: 'Xilinx standard module that will infer RAM during FPGA synthesis',
      code: `module ram_infer #(
  parameter ADDR_WIDTH = 10,
  parameter DATA_WIDTH = 8
)(
  input wire clk,
  input wire we,    // Write enable
  input wire [ADDR_WIDTH-1:0] addr,
  input wire [DATA_WIDTH-1:0] din,
  output reg [DATA_WIDTH-1:0] dout
);
  
  reg [DATA_WIDTH-1:0] ram [(1<<ADDR_WIDTH)-1:0];
  
  always @(posedge clk) begin
    if (we)
      ram[addr] <= din;
    
    dout <= ram[addr];
  end
endmodule`
    },
    {
      name: 'reset.v',
      category: 'Utility',
      description: 'Implements a "good" reset with asynchronous assertion and synchronous de-assertion',
      code: `module reset #(
  parameter RESET_CYCLES = 16
)(
  input wire clk,
  input wire async_reset_in,  // Active high external reset input
  output wire sync_reset_out  // Active high synchronized reset output
);
  
  reg [RESET_CYCLES-1:0] reset_shift_reg = {RESET_CYCLES{1'b1}};
  
  always @(posedge clk or posedge async_reset_in) begin
    if (async_reset_in) begin
      reset_shift_reg <= {RESET_CYCLES{1'b1}};
    end else begin
      reset_shift_reg <= {reset_shift_reg[RESET_CYCLES-2:0], 1'b0};
    end
  end
  
  assign sync_reset_out = reset_shift_reg[RESET_CYCLES-1];
endmodule`
    },
    {
      name: 'sign_extender.v',
      category: 'Utility',
      description: 'Explicit sign extender',
      code: `module sign_extender #(
  parameter INPUT_WIDTH = 16,
  parameter OUTPUT_WIDTH = 32
)(
  input wire [INPUT_WIDTH-1:0] in,
  output wire [OUTPUT_WIDTH-1:0] out
);
  
  // Sign extension
  assign out = {{(OUTPUT_WIDTH-INPUT_WIDTH){in[INPUT_WIDTH-1]}}, in};
endmodule`
    },
    {
      name: 'sqrt_generic.v',
      category: 'Computation',
      description: 'A cleaner fixed point square root implementation using implicit truncation rounding',
      code: `module sqrt_generic #(
  parameter WIDTH = 32,         // Width of input and output
  parameter FRAC_BITS = 16,     // Number of fractional bits
  parameter PIPELINE_STAGES = 16 // Number of pipeline stages
)(
  input wire clk,
  input wire reset,
  input wire start,
  input wire [WIDTH-1:0] x_in,  // Input value
  output wire [WIDTH-1:0] y_out, // Square root result
  output wire done              // Calculation done flag
);
  
  localparam ITERATIONS = WIDTH/2;
  
  // Internal registers
  reg [WIDTH-1:0] x [0:PIPELINE_STAGES-1];
  reg [WIDTH-1:0] q [0:PIPELINE_STAGES-1];
  reg [WIDTH-1:0] a [0:PIPELINE_STAGES-1];
  reg [WIDTH-1:0] r [0:PIPELINE_STAGES-1];
  reg [WIDTH-1:0] temp [0:PIPELINE_STAGES-1];
  
  // Pipeline control signals
  reg [PIPELINE_STAGES-1:0] valid;
  
  // First stage initialization
  always @(posedge clk or posedge reset) begin
    if (reset) begin
      x[0] <= 0;
      q[0] <= 0;
      a[0] <= 0;
      r[0] <= 0;
      valid[0] <= 0;
    end else begin
      if (start) begin
        x[0] <= x_in;
        q[0] <= 0;
        a[0] <= 0;
        r[0] <= 0;
        valid[0] <= 1;
      end else begin
        valid[0] <= 0;
      end
    end
  end
  
  // Pipeline stages
  genvar i;
  generate
    for (i = 1; i < PIPELINE_STAGES; i = i + 1) begin : sqrt_stage
      localparam bit_pos = WIDTH - 2*i;
      
      always @(posedge clk or posedge reset) begin
        if (reset) begin
          x[i] <= 0;
          q[i] <= 0;
          a[i] <= 0;
          r[i] <= 0;
          valid[i] <= 0;
        end else begin
          x[i] <= x[i-1];
          valid[i] <= valid[i-1];
          
          if (valid[i-1]) begin
            // Compute next bit of sqrt
            temp[i-1] = a[i-1] | (1 << bit_pos);
            
            if (r[i-1] < temp[i-1]) begin
              q[i] <= q[i-1];
              a[i] <= a[i-1] << 2;
              r[i] <= (r[i-1] << 2) | ((x[i-1] >> (WIDTH-2*i-2)) & 3);
            end else begin
              q[i] <= q[i-1] | (1 << bit_pos);
              a[i] <= (temp[i-1] + (1 << bit_pos)) << 1;
              r[i] <= ((r[i-1] - temp[i-1]) << 2) | ((x[i-1] >> (WIDTH-2*i-2)) & 3);
            end
          end else begin
            q[i] <= q[i-1];
            a[i] <= a[i-1];
            r[i] <= r[i-1];
          end
        end
      end
    end
  endgenerate
  
  // Output assignment
  assign y_out = q[PIPELINE_STAGES-1];
  assign done = valid[PIPELINE_STAGES-1];
endmodule`
    },
    {
      name: 'uart_rx.v',
      category: 'Communication',
      description: 'UART receiver',
      code: `module uart_rx #(
  parameter CLKS_PER_BIT = 868 // 100MHz / 115200 Baud
)(
  input wire clk,
  input wire reset,
  input wire rx_in,
  output reg rx_done,
  output reg [7:0] rx_data
);
  
  // States
  localparam IDLE = 2'b00;
  localparam START = 2'b01;
  localparam DATA = 2'b10;
  localparam STOP = 2'b11;
  
  reg [1:0] state = IDLE;
  reg [31:0] clk_counter = 0;
  reg [2:0] bit_index = 0;
  reg [7:0] rx_byte = 0;
  
  always @(posedge clk or posedge reset) begin
    if (reset) begin
      state <= IDLE;
      clk_counter <= 0;
      bit_index <= 0;
      rx_byte <= 0;
      rx_done <= 0;
      rx_data <= 0;
    end else begin
      case (state)
      
        IDLE: begin
          rx_done <= 0;
          clk_counter <= 0;
          bit_index <= 0;
          
          if (rx_in == 1'b0) // Start bit detected
            state <= START;
          else
            state <= IDLE;
        end
        
        START: begin
          // Check middle of start bit
          if (clk_counter == (CLKS_PER_BIT-1)/2) begin
            if (rx_in == 1'b0) begin
              clk_counter <= 0;
              state <= DATA;
            end else
              state <= IDLE;
          end else begin
            clk_counter <= clk_counter + 1;
            state <= START;
          end
        end
        
        DATA: begin
          if (clk_counter < CLKS_PER_BIT-1) begin
            clk_counter <= clk_counter + 1;
            state <= DATA;
          end else begin
            clk_counter <= 0;
            rx_byte[bit_index] <= rx_in;
            
            if (bit_index < 7) begin
              bit_index <= bit_index + 1;
              state <= DATA;
            end else begin
              bit_index <= 0;
              state <= STOP;
            end
          end
        end
        
        STOP: begin
          if (clk_counter < CLKS_PER_BIT-1) begin
            clk_counter <= clk_counter + 1;
            state <= STOP;
          end else begin
            rx_done <= 1'b1;
            rx_data <= rx_byte;
            clk_counter <= 0;
            state <= IDLE;
          end
        end
        
        default: state <= IDLE;
      endcase
    end
  end
endmodule`
    },
    {
      name: 'uart_tx.v',
      category: 'Communication',
      description: 'UART transmitter',
      code: `module uart_tx #(
  parameter CLKS_PER_BIT = 868 // 100MHz / 115200 Baud
)(
  input wire clk,
  input wire reset,
  input wire tx_start,
  input wire [7:0] tx_data,
  output reg tx_out,
  output reg tx_done
);
  
  // States
  localparam IDLE = 2'b00;
  localparam START = 2'b01;
  localparam DATA = 2'b10;
  localparam STOP = 2'b11;
  
  reg [1:0] state = IDLE;
  reg [31:0] clk_counter = 0;
  reg [2:0] bit_index = 0;
  reg [7:0] tx_byte = 0;
  
  always @(posedge clk or posedge reset) begin
    if (reset) begin
      state <= IDLE;
      clk_counter <= 0;
      bit_index <= 0;
      tx_byte <= 0;
      tx_out <= 1'b1; // Idle high
      tx_done <= 0;
    end else begin
      case (state)
      
        IDLE: begin
          tx_out <= 1'b1; // Idle high
          tx_done <= 0;
          clk_counter <= 0;
          bit_index <= 0;
          
          if (tx_start == 1'b1) begin
            tx_byte <= tx_data;
            state <= START;
          end else
            state <= IDLE;
        end
        
        START: begin
          tx_out <= 1'b0; // Start bit is low
          
          if (clk_counter < CLKS_PER_BIT-1) begin
            clk_counter <= clk_counter + 1;
            state <= START;
          end else begin
            clk_counter <= 0;
            state <= DATA;
          end
        end
        
        DATA: begin
          tx_out <= tx_byte[bit_index];
          
          if (clk_counter < CLKS_PER_BIT-1) begin
            clk_counter <= clk_counter + 1;
            state <= DATA;
          end else begin
            clk_counter <= 0;
            
            if (bit_index < 7) begin
              bit_index <= bit_index + 1;
              state <= DATA;
            end else begin
              bit_index <= 0;
              state <= STOP;
            end
          end
        end
        
        STOP: begin
          tx_out <= 1'b1; // Stop bit is high
          
          if (clk_counter < CLKS_PER_BIT-1) begin
            clk_counter <= clk_counter + 1;
            state <= STOP;
          end else begin
            tx_done <= 1'b1;
            clk_counter <= 0;
            state <= IDLE;
          end
        end
        
        default: state <= IDLE;
      endcase
    end
  end
endmodule`
    },
    {
      name: 'div_pipelined.v',
      category: 'Computation',
      description: 'Pipelined division module (largely untested)',
      code: `module div_pipelined #(
  parameter WIDTH = 32,
  parameter PIPELINE_STAGES = 32
)(
  input wire clk,
  input wire reset,
  input wire start,
  input wire [WIDTH-1:0] dividend,
  input wire [WIDTH-1:0] divisor,
  output wire [WIDTH-1:0] quotient,
  output wire [WIDTH-1:0] remainder,
  output wire done,
  output wire error  // Division by zero error
);
  
  // Registers for each pipeline stage
  reg [WIDTH-1:0] divisor_reg [0:PIPELINE_STAGES-1];
  reg [WIDTH-1:0] quotient_reg [0:PIPELINE_STAGES-1];
  reg [WIDTH-1:0] remainder_reg [0:PIPELINE_STAGES-1];
  reg valid_reg [0:PIPELINE_STAGES-1];
  reg error_reg [0:PIPELINE_STAGES-1];
  
  // First stage initialization
  always @(posedge clk or posedge reset) begin
    if (reset) begin
      divisor_reg[0] <= 0;
      quotient_reg[0] <= 0;
      remainder_reg[0] <= 0;
      valid_reg[0] <= 0;
      error_reg[0] <= 0;
    end else begin
      if (start) begin
        divisor_reg[0] <= divisor;
        quotient_reg[0] <= 0;
        remainder_reg[0] <= dividend;
        valid_reg[0] <= 1;
        error_reg[0] <= (divisor == 0);
      end else begin
        valid_reg[0] <= 0;
        error_reg[0] <= 0;
      end
    end
  end
  
  // Pipeline stages
  genvar i;
  generate
    for (i = 1; i < PIPELINE_STAGES; i = i + 1) begin : div_stage
      always @(posedge clk or posedge reset) begin
        if (reset) begin
          divisor_reg[i] <= 0;
          quotient_reg[i] <= 0;
          remainder_reg[i] <= 0;
          valid_reg[i] <= 0;
          error_reg[i] <= 0;
        end else begin
          divisor_reg[i] <= divisor_reg[i-1];
          error_reg[i] <= error_reg[i-1];
          valid_reg[i] <= valid_reg[i-1];
          
          if (valid_reg[i-1] && !error_reg[i-1]) begin
            if (remainder_reg[i-1] >= divisor_reg[i-1]) begin
              quotient_reg[i] <= quotient_reg[i-1] | (1 << (PIPELINE_STAGES-1-i));
              remainder_reg[i] <= remainder_reg[i-1] - divisor_reg[i-1];
            end else begin
              quotient_reg[i] <= quotient_reg[i-1];
              remainder_reg[i] <= remainder_reg[i-1];
            end
            
            // Shift for next stage
            if (i < PIPELINE_STAGES-1) begin
              divisor_reg[i] <= divisor_reg[i-1] >> 1;
            end
          end else begin
            quotient_reg[i] <= quotient_reg[i-1];
            remainder_reg[i] <= remainder_reg[i-1];
          end
        end
      end
    end
  endgenerate
  
  // Output assignment
  assign quotient = quotient_reg[PIPELINE_STAGES-1];
  assign remainder = remainder_reg[PIPELINE_STAGES-1];
  assign done = valid_reg[PIPELINE_STAGES-1];
  assign error = error_reg[PIPELINE_STAGES-1];
endmodule`
    }
  ];
  
  // Inicialização do gerenciador
  const init = () => {
    // Inicializar dados
    blocks = verilogBlocks;
    
    // Configurar elementos do DOM
    modal = document.getElementById('verilog-block-modal');
    blockSearch = document.getElementById('block-search');
    clearSearchBtn = document.getElementById('clear-search');
    closeModalBtn = document.getElementById('close-modal');
    categoriesList = document.getElementById('categories-list');
    blocksList = document.getElementById('blocks-list');
    selectedBlockName = document.getElementById('selected-block-name');
    insertBlockBtn = document.getElementById('insert-block-btn');
    
    // Configurar eventos
    setupEventListeners();
    
    // Renderizar categorias e blocos
    renderCategories();
    renderBlocks();
  };
  
  // Configurar event listeners
  const setupEventListeners = () => {
    // Pesquisa de blocos
    blockSearch.addEventListener('input', handleSearch);
    clearSearchBtn.addEventListener('click', clearSearch);
    
    // Fechar modal
    closeModalBtn.addEventListener('click', hideModal);
    
    // Inserir bloco
    insertBlockBtn.addEventListener('click', insertSelectedBlock);
    
    // Fechar modal ao clicar fora
    window.addEventListener('click', (event) => {
      if (event.target === modal) {
        hideModal();
      }
    });
    
    // Fechar modal com ESC
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isModalVisible()) {
        hideModal();
      }
    });
    
    // Botão da barra de ferramentas
    const verilogBlockBtn = document.getElementById('verilog-block');
    if (verilogBlockBtn) {
      verilogBlockBtn.addEventListener('click', () => {
        if (isVerilogFile()) {
          showModal();
        } else {
          // Alerta se não for um arquivo Verilog
          alert('Por favor, abra um arquivo Verilog (.v) antes de inserir blocos.');
        }
      });
    }
  };
  
  // Renderizar categorias
  const renderCategories = () => {
    categoriesList.innerHTML = '';
    
    categories.forEach(category => {
      const li = document.createElement('li');
      li.textContent = category;
      li.className = category === activeCategory ? 'active' : '';
      li.addEventListener('click', () => {
        setActiveCategory(category);
      });
      
      categoriesList.appendChild(li);
    });
  };
  
  // Renderizar blocos
  const renderBlocks = () => {
    blocksList.innerHTML = '';
    
    // Filtrar blocos pela categoria ativa e termo de pesquisa
    const searchTerm = blockSearch.value.toLowerCase();
    const filteredBlocks = blocks.filter(block => {
      const matchesCategory = activeCategory === 'All' || block.category === activeCategory;
      const matchesSearch = searchTerm === '' || 
                            block.name.toLowerCase().includes(searchTerm) || 
                            block.description.toLowerCase().includes(searchTerm);
      
      return matchesCategory && matchesSearch;
    });
    
    if (filteredBlocks.length === 0) {
      const noResults = document.createElement('div');
      noResults.className = 'no-results';
      noResults.innerHTML = `<i class="fas fa-search"></i><p>Nenhum bloco encontrado</p>`;
      blocksList.appendChild(noResults);
      return;
    }
    
    // Agrupar por categoria
    const blocksByCategory = {};
    
    filteredBlocks.forEach(block => {
      if (!blocksByCategory[block.category]) {
        blocksByCategory[block.category] = [];
      }
      blocksByCategory[block.category].push(block);
    });
    
    // Criar blocos por categoria
    Object.keys(blocksByCategory).sort().forEach(category => {
      if (activeCategory !== 'All') return; // Não mostrar cabeçalhos de categoria quando uma categoria está selecionada
      
      const categoryHeader = document.createElement('div');
      categoryHeader.className = 'category-header';
      categoryHeader.textContent = category;
      blocksList.appendChild(categoryHeader);
      
      renderBlocksForCategory(blocksByCategory[category]);
    });
    
    // Se uma categoria específica estiver selecionada, renderizar blocos diretamente
    if (activeCategory !== 'All' && blocksByCategory[activeCategory]) {
      renderBlocksForCategory(blocksByCategory[activeCategory]);
    }
  };
  
  // Renderizar blocos para uma categoria específica
  const renderBlocksForCategory = (categoryBlocks) => {
    categoryBlocks.forEach(block => {
      const blockElement = document.createElement('div');
      blockElement.className = 'block-item';
      blockElement.dataset.blockName = block.name;
      
      if (selectedBlock && selectedBlock.name === block.name) {
        blockElement.classList.add('selected');
      }
      
      blockElement.innerHTML = `
        <div class="block-icon">
          <i class="fas fa-microchip"></i>
        </div>
        <div class="block-info">
          <div class="block-name">${block.name}</div>
          <div class="block-description">${block.description}</div>
        </div>
      `;
      
      blockElement.addEventListener('click', () => {
        selectBlock(block);
      });
      
      blocksList.appendChild(blockElement);
    });
  };
  
  // Selecionar um bloco
  const selectBlock = (block) => {
    // Desselecionar bloco anterior
    const previousSelected = blocksList.querySelector('.block-item.selected');
    if (previousSelected) {
      previousSelected.classList.remove('selected');
    }
    
    // Selecionar novo bloco
    selectedBlock = block;
    const blockElement = blocksList.querySelector(`.block-item[data-block-name="${block.name}"]`);
    if (blockElement) {
      blockElement.classList.add('selected');
    }
    
    // Atualizar informações
    selectedBlockName.textContent = block.name;
    insertBlockBtn.disabled = false;
  };
  
  // Inserir o bloco selecionado no editor
  const insertSelectedBlock = () => {
    if (!selectedBlock) return;
    
    // Verificar se o editor está disponível
    if (!window.editor) {
      alert('Editor não está disponível.');
      return;
    }
    
    // Verificar se é um arquivo Verilog
    if (!isVerilogFile()) {
      alert('Por favor, abra um arquivo Verilog (.v) antes de inserir blocos.');
      return;
    }
    
    // Inserir o código no cursor atual
    const position = window.editor.getPosition();
    window.editor.executeEdits('verilog-block-insert', [
      {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        },
        text: selectedBlock.code
      }
    ]);
    
    // Esconder o modal após inserir
    hideModal();
  };
  
  // Verificar se o arquivo atual é um arquivo Verilog
  const isVerilogFile = () => {
    if (window.activeFile) return false;
    
    const extension = 'v'
    return extension === 'v';
  };
  
  // Manipular pesquisa
  const handleSearch = () => {
    renderBlocks();
  };
  
  // Limpar pesquisa
  const clearSearch = () => {
    blockSearch.value = '';
    renderBlocks();
  };
  
  // Definir categoria ativa
  const setActiveCategory = (category) => {
    activeCategory = category;
    renderCategories();
    renderBlocks();
  };
  
  // Mostrar modal
  const showModal = () => {
    modal.style.display = 'flex';
    setTimeout(() => {
      modal.classList.add('show');
      blockSearch.focus();
    }, 10);
    
    // Resetar estado
    selectedBlock = null;
    selectedBlockName.textContent = 'Nenhum bloco selecionado';
    insertBlockBtn.disabled = true;
    
    // Renderizar blocos
    setActiveCategory('All');
    clearSearch();
  };
  
  // Esconder modal
  const hideModal = () => {
    modal.classList.remove('show');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 300);
  };
  
  // Verificar se o modal está visível
  const isModalVisible = () => {
    return modal && modal.style.display === 'flex';
  };
  
  // API pública
  return {
    init,
    showModal,
    hideModal
  };
})();

// Inicializar o gerenciador quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  VerilogBlockManager.init();
});