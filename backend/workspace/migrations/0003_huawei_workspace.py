from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("workspace", "0002_daily_tasks_and_snippets")]

    operations = [
        migrations.AddField(
            model_name="workspacepreferences",
            name="huawei_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="workspacepreferences",
            name="active_workspace",
            field=models.CharField(default="personal", max_length=10),
        ),
        migrations.AddConstraint(
            model_name="workspacepreferences",
            constraint=models.CheckConstraint(
                condition=models.Q(active_workspace__in=["personal", "huawei"]),
                name="valid_active_workspace",
            ),
        ),
        migrations.AddConstraint(
            model_name="workspacepreferences",
            constraint=models.CheckConstraint(
                condition=models.Q(huawei_enabled=True) | models.Q(active_workspace="personal"),
                name="active_huawei_requires_enabled",
            ),
        ),
    ]
