from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from models.entities import Task, TaskParagraph


def _now():
    return datetime.now(timezone.utc)


def create_task(
    db: Session,
    *,
    task_id: str,
    user_id: str,
    mode: str,
    status: str,
    title: str,
    paragraphs: list[dict],
) -> Task:
    task = Task(
        id=task_id,
        user_id=user_id,
        mode=mode,
        status=status,
        created_at=_now(),
        title=title,
    )
    db.add(task)
    db.flush()
    for p in paragraphs:
        db.add(
            TaskParagraph(
                task_id=task.id,
                idx=int(p["index"]),
                word_count=int(p["wordCount"]),
                original=str(p["original"]),
                polished=str(p["polished"]),
                model_used=p.get("modelUsed"),
            )
        )
    db.commit()
    return get_task_for_user(db, task.id, user_id)  # type: ignore[return-value]


def list_tasks_for_user(db: Session, user_id: str) -> list[Task]:
    stmt = (
        select(Task)
        .options(selectinload(Task.paragraphs))
        .where(Task.user_id == user_id)
        .order_by(Task.created_at.desc())
    )
    return list(db.scalars(stmt))


def get_task_for_user(db: Session, task_id: str, user_id: str) -> Task | None:
    stmt = (
        select(Task)
        .options(selectinload(Task.paragraphs))
        .where(Task.id == task_id, Task.user_id == user_id)
    )
    return db.scalar(stmt)


def get_paragraph(db: Session, task_id: str, idx: int) -> TaskParagraph | None:
    stmt = select(TaskParagraph).where(TaskParagraph.task_id == task_id, TaskParagraph.idx == idx)
    return db.scalar(stmt)


def update_task_paragraph_result(
    db: Session,
    *,
    task_id: str,
    idx: int,
    polished: str,
    word_count: int,
    model_used: str | None,
    task_status: str = "done",
) -> TaskParagraph | None:
    para = get_paragraph(db, task_id, idx)
    if not para:
        return None
    para.polished = polished
    para.word_count = word_count
    para.model_used = model_used
    task = db.get(Task, task_id)
    if task:
        task.status = task_status
    db.commit()
    db.refresh(para)
    return para

