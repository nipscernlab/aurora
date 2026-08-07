"""Testbench cocotb que falha de proposito.

Existe para provar que uma falha de teste chega ate a AURORA. O runner do
cocotb sai com codigo 0 mesmo quando um teste falha, entao ate a correcao
deste comportamento a IDE reportava "simulacao bem-sucedida" para um
testbench reprovado — o unico veredito que um testbench existe para dar.
"""

import cocotb
from cocotb.triggers import Timer


@cocotb.test()
async def falha_deliberada(dut):
    await Timer(10, unit="ns")
    assert False, "falha deliberada: o codigo de saida precisa refletir isto"
