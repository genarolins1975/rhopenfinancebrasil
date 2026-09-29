import { describe, expect, it } from "vitest";
import { csvTemplate, parseCsv } from "@/modules/employees/import";

describe("leitor CSV", () => {
  it("detecta ponto e vírgula, trata aspas e BOM", () => {
    const text = '﻿nome;email;cpf\n"Silva; Ana";ana@x.org;"00000000000"\r\nBruno;bruno@x.org;11111111111\n';
    const { header, rows, delimiter } = parseCsv(text);
    expect(delimiter).toBe(";");
    expect(header).toEqual(["nome", "email", "cpf"]);
    expect(rows[0]).toEqual(["Silva; Ana", "ana@x.org", "00000000000"]);
    expect(rows).toHaveLength(2);
  });
  it("detecta vírgula e ignora linhas vazias", () => {
    const { rows, delimiter } = parseCsv("a,b\n1,2\n\n3,4\n");
    expect(delimiter).toBe(",");
    expect(rows).toEqual([["1", "2"], ["3", "4"]]);
  });
  it("modelo tem as colunas obrigatórias", () => {
    const { header } = parseCsv(csvTemplate());
    expect(header).toEqual(["nome", "email", "cpf", "area", "cargo", "gestor_email", "condicao", "data_admissao"]);
  });
});
