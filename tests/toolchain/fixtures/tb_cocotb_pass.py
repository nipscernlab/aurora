"""Testbench cocotb que passa: exercita o processador SAPHO gerado.

Solta o reset, gira o clock e confirma que o processador chega a pedir dado
na porta de entrada (req_in sobe). Isso prova que o RTL gerado elabora sob
cocotb, que a ponte VPI funciona, e que o lado Python consegue ler sinais.
"""

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer


@cocotb.test()
async def processador_sai_do_reset_e_pede_entrada(dut):
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    dut.rst.value = 1
    # "in" e palavra reservada em Python; o handle so sai por getattr.
    getattr(dut, "in").value = 0
    await Timer(50, unit="ns")
    dut.rst.value = 0

    for _ in range(500):
        await RisingEdge(dut.clk)
        if int(dut.req_in.value) == 1:
            return
    assert False, "o processador nunca pediu dado na porta de entrada"
