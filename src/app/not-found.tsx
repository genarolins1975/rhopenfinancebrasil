import Link from "next/link";

export default function NotFound() {
  return (
    <main id="conteudo" className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">Página não encontrada</h1>
      <p className="mt-2 text-text-muted">O endereço não existe ou você não tem acesso a ele.</p>
      <p className="mt-4">
        <Link href="/inicio" className="underline">
          Ir para o início
        </Link>
      </p>
    </main>
  );
}
