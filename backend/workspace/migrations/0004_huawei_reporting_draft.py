from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("workspace", "0003_huawei_workspace")]

    operations = [
        migrations.CreateModel(
            name="HuaweiReportingDraft",
            fields=[
                ("id", models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)),
                ("config", models.JSONField(default=dict)),
                ("revision", models.PositiveIntegerField(default=0)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"constraints": [
                models.CheckConstraint(condition=models.Q(id=1), name="single_huawei_reporting_draft"),
            ]},
        ),
    ]
