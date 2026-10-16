"""Run inside the installed GlitchTip container. Only a threshold boolean leaves it."""
import datetime
import json
import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "glitchtip.settings")
import django

django.setup()
from django.db import connection, transaction
from django.utils import timezone
from apps.projects.models import Project
from apps.issue_events.models import IssueEvent
from glitchtip.partition_manager import UUID7Helper

with transaction.atomic():
    with connection.cursor() as cursor:
        cursor.execute("SET LOCAL statement_timeout = '2000ms'")
    project = Project.objects.get(slug="havefolio", is_deleted=False)
    start = timezone.now() - datetime.timedelta(minutes=5)
    start_id = UUID7Helper._uuid7_for_timestamp(start, min_random=True)
    # LIMIT 3, project/organization and server receipt time; no raw event is fetched.
    count = len(list(IssueEvent.objects.filter(
        organization_id=project.organization_id, issue__project_id=project.pk,
        id__gte=start_id, data__environment="production", level__gte=40,
    ).values_list("id", flat=True)[:3]))
print(json.dumps({"errorThresholdReached": count >= 3}))
