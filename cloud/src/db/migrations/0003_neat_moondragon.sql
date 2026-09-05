-- La numerazione delle card diventa per progetto (PK composita), come in kanban-md:
-- serve alla migrazione che preserva i numeri («#18» sta nei commit e nei doc), e due
-- progetti importati non collidono più sull'id 1. Gli id esistenti restano validi:
-- erano unici per tabella, quindi lo sono anche dentro il proprio progetto.
--
-- `tasks_pkey` è il nome di default di Postgres per la PK creata con la tabella:
-- drizzle-kit non sa ancora leggerlo da sé (vedi il commento che generava qui).
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_pkey";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "id" DROP IDENTITY;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_id_pk" PRIMARY KEY("project_id","id");
